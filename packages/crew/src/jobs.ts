// Jobs: agents start a script, end their session, and wake on job.succeeded/failed/timeout.
// The runner (crew job exec) owns the lifecycle, so a completion event fires even if the script crashes.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, isAbsolute } from "node:path";
import {
  type Args,
  type Crew,
  CrewError,
  type Md,
  type Out,
  actorOf,
  agentLog,
  dirname,
  emit,
  flag,
  flags,
  join,
  nextId,
  parseDuration,
  pidAlive,
  readJson,
  readMd,
  resolve,
  tail,
  withMutex,
  writeJson,
  writeMd,
} from "./core";

export const CLI = resolve(process.argv[1] ?? "");
export const HELPERS = resolve(dirname(CLI), "..", "..", "helpers");

export type Job = {
  id: string;
  agent: string;
  task: string | null;
  script: string;
  args: string[];
  cwd: string;
  lock: string | null;
  timeout: string;
  status: "queued" | "waiting" | "running" | "succeeded" | "failed" | "timeout" | "killed";
  pid: number | null;
  exit: number | null;
  created: string;
  started: string | null;
  ended: string | null;
};

const jobMd = (c: Crew, id: string) => c.p("jobs", id, "job.md");

export function loadJob(c: Crew, id: string): { j: Job; md: Md } {
  if (!existsSync(jobMd(c, id))) throw new CrewError(`No job ${id}.`);
  const md = readMd(jobMd(c, id));
  return { j: md.data as Job, md };
}
export function saveJob(c: Crew, j: Job, md: Md): void {
  md.data = j;
  writeMd(jobMd(c, j.id), md);
}

export function listJobs(c: Crew): Job[] {
  const d = c.p("jobs");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((x) => /^J-\d+$/.test(x) && existsSync(join(d, x, "job.md")))
    .sort()
    .map((x) => readMd(join(d, x, "job.md")).data as Job);
}

type Locks = Record<string, { job: string; since: string }>;
const locksPath = (c: Crew) => c.p(".state", "locks.json");
export const readLocks = (c: Crew): Locks => readJson<Locks>(locksPath(c), {});

export function releaseLocksFor(c: Crew, jobId: string): void {
  const l = readLocks(c);
  let changed = false;
  for (const [k, v] of Object.entries(l))
    if (v.job === jobId) {
      delete l[k];
      changed = true;
      emit(c, { type: "lock.released", by: "crew", data: { lock: k, job: jobId } });
    }
  if (changed) writeJson(locksPath(c), l);
}

// crew job run --script path [--task T] [--lock gpu] [--timeout 20m] [--note "wake plan"] [-- args...]
export function jobRun(c: Crew, a: Args, o: Out): void {
  const agent = actorOf(a);
  const s = flag(a, "script");
  if (!s) throw new CrewError("Usage: crew job run --script <path> [--task id] [--lock name] [--timeout 20m] [--note text] [-- args]");
  const candidates = isAbsolute(s) ? [s] : [resolve(process.cwd(), s), c.p("agents", agent, s)];
  const script = candidates.find((p) => existsSync(p));
  if (!script) throw new CrewError(`Script not found: ${s} (looked in ${candidates.join(", ")}).`);
  const lock = flag(a, "lock") ?? null;
  if (lock && !(c.config().locks ?? []).includes(lock)) throw new CrewError(`Unknown lock "${lock}". Declare it in crew.md locks.`);
  const timeout = flag(a, "timeout") ?? "15m";
  parseDuration(timeout, 0);
  const id = nextId(c, "J");
  const task = flag(a, "task") ?? process.env.CREW_TASK ?? null;
  const j: Job = {
    id,
    agent,
    task,
    script,
    args: flags(a, "--"),
    cwd: process.cwd(),
    lock,
    timeout,
    status: "queued",
    pid: null,
    exit: null,
    created: new Date().toISOString(),
    started: null,
    ended: null,
  };
  const note =
    flag(a, "note") ??
    "## Intent\n\n(What this job does and why.)\n\n## On success\n\n(What to do next.)\n\n## On failure\n\n(How to recover.)";
  mkdirSync(join(c.p("jobs", id), "out"), { recursive: true });
  saveJob(c, j, { data: {}, body: `\n# ${id}${task ? ` for [[${task}]]` : ""}\n\n${note}\n` });
  emit(c, { type: "job.queued", by: agent, agent, task: task ?? undefined, data: { job: id, script, lock } });
  agentLog(c, agent, `started job ${id} (${script.split("/").pop()})`, task);
  const child = spawn(process.execPath, [CLI, "job", "exec", id], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CREW_VAULT: c.vault },
  });
  child.unref();
  o.json = j;
  o.say(`${id} queued. End your session now; you'll be woken on job.succeeded, job.failed or job.timeout.`);
}

function interpreter(script: string): string[] {
  switch (extname(script)) {
    case ".ts":
    case ".js":
    case ".mjs":
      return [process.execPath, script];
    case ".py":
      return ["python3", script];
    case ".sh":
      return ["bash", script];
    default:
      return [script];
  }
}

// Internal: runs detached. Waits for lock and job slot, runs the script, always emits a completion event.
export async function jobExec(c: Crew, id: string): Promise<void> {
  const maxJobs = c.config().limits?.max_jobs ?? 4;
  let announced = false;
  for (;;) {
    const got = await withMutex(c, () => {
      const running = listJobs(c).filter((x) => x.status === "running" && pidAlive(x.pid)).length;
      const locks = readLocks(c);
      const { j, md } = loadJob(c, id);
      if (j.status === "killed") return "killed";
      if (running >= maxJobs || (j.lock && locks[j.lock])) return "wait";
      if (j.lock) {
        locks[j.lock] = { job: id, since: new Date().toISOString() };
        writeJson(locksPath(c), locks);
        emit(c, { type: "lock.granted", by: "crew", agent: j.agent, data: { lock: j.lock, job: id } });
      }
      j.status = "running";
      j.pid = process.pid;
      j.started = new Date().toISOString();
      saveJob(c, j, md);
      return "go";
    });
    if (got === "killed") return;
    if (got === "go") break;
    if (!announced) {
      const { j } = loadJob(c, id);
      emit(c, { type: "job.waiting", by: "crew", agent: j.agent, task: j.task ?? undefined, data: { job: id, lock: j.lock } });
      announced = true;
    }
    await Bun.sleep(2000);
  }

  const { j } = loadJob(c, id);
  const dir = c.p("jobs", id);
  const logPath = join(dir, "run.log");
  emit(c, { type: "job.started", by: "crew", agent: j.agent, task: j.task ?? undefined, data: { job: id } });
  const fd = openSync(logPath, "a");
  const py = join(HELPERS, "python");
  const env = {
    ...process.env,
    CREW_VAULT: c.vault,
    CREW_AGENT: j.agent,
    CREW_TASK: j.task ?? "",
    CREW_JOB_ID: id,
    CREW_JOB_DIR: dir,
    CREW_JOB_OUT: join(dir, "out"),
    CREW_BUN: process.execPath,
    CREW_CLI: CLI,
    CREW_HELPERS: HELPERS,
    PYTHONPATH: process.env.PYTHONPATH ? `${py}:${process.env.PYTHONPATH}` : py,
  };
  const [cmd, ...rest] = interpreter(j.script);
  let timedOut = false;
  const exit = await new Promise<number>((res) => {
    const child = spawn(cmd!, [...rest, ...j.args], { cwd: existsSync(j.cwd) ? j.cwd : dir, env, stdio: ["ignore", fd, fd] });
    const ms = parseDuration(j.timeout, 15 * 6e4);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, ms);
    child.on("error", (e) => {
      writeFileSync(logPath, `\n[crew] failed to start: ${e.message}\n`, { flag: "a" });
      clearTimeout(timer);
      res(127);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      res(code ?? (signal ? 128 : 1));
    });
  });
  closeSync(fd);

  const result = readJson<Record<string, unknown>>(join(dir, "result.json"), {});
  const out = existsSync(join(dir, "out")) ? readdirSync(join(dir, "out")).map((f) => join(dir, "out", f)) : [];
  const files = [...new Set([...((result.files as string[] | undefined) ?? []), ...out])];
  const status: Job["status"] = timedOut ? "timeout" : exit === 0 ? "succeeded" : "failed";
  const logTail = tail(readFileSync(logPath, "utf8").trimEnd(), 50);

  await withMutex(c, () => {
    const cur = loadJob(c, id);
    if (cur.j.status === "killed") {
      releaseLocksFor(c, id);
      return;
    }
    cur.j.status = status;
    cur.j.exit = exit;
    cur.j.ended = new Date().toISOString();
    saveJob(c, cur.j, cur.md);
    releaseLocksFor(c, id);
    emit(c, {
      type: `job.${status}`,
      by: "crew",
      agent: j.agent,
      task: j.task ?? undefined,
      data: { job: id, exit, files, result, tail: logTail },
    });
    agentLog(c, j.agent, `job ${id} ${status} (exit ${exit})`, j.task);
  });
}

export function jobsCmd(c: Crew, o: Out): void {
  const js = listJobs(c);
  o.json = { jobs: js, locks: readLocks(c) };
  if (!js.length) return o.say("No jobs.");
  for (const j of js.slice(-30))
    o.say(`${j.id}  ${j.status.padEnd(9)}  ${j.agent.padEnd(12)}  ${j.task ?? "-"}  ${j.lock ? `lock:${j.lock} ` : ""}${j.script.split("/").pop()}`);
  const l = readLocks(c);
  if (Object.keys(l).length) o.say(`locks held: ${Object.entries(l).map(([k, v]) => `${k} by ${v.job}`).join(", ")}`);
}

export async function jobKill(c: Crew, id: string, o: Out, by: string): Promise<void> {
  await withMutex(c, () => {
    const { j, md } = loadJob(c, id);
    if (!["queued", "waiting", "running"].includes(j.status)) return o.say(`${id} already ${j.status}.`);
    if (j.pid && pidAlive(j.pid)) {
      // job exec runs detached as a process-group leader, so this also stops the script it started.
      try {
        process.kill(-j.pid, "SIGTERM");
      } catch {
        try {
          process.kill(j.pid, "SIGTERM");
        } catch {
          /* gone */
        }
      }
    }
    j.status = "killed";
    j.ended = new Date().toISOString();
    saveJob(c, j, md);
    releaseLocksFor(c, id);
    emit(c, { type: "job.failed", by, agent: j.agent, task: j.task ?? undefined, data: { job: id, exit: null, reason: "killed" } });
    o.say(`${id} killed.`);
  });
}

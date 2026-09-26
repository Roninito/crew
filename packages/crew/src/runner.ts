// Agent sessions: build the wake prompt, launch the runner CLI (Claude Code, OpenCode, ...), track spend.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type Agent, getAgent, listAgents } from "./agents";
import { addSpend, spendToday } from "./comms";
import {
  type Args,
  type Crew,
  CrewError,
  type CrewEvent,
  type Out,
  actorOf,
  agentLog,
  emit,
  flag,
  join,
  pidAlive,
  readJson,
  today,
  withMutex,
  writeJson,
} from "./core";
import { SELF_ARGS, jobKill, listJobs, readLocks } from "./jobs";
import { listTasks, releaseTask } from "./tasks";

export type Wake = { reason: string; event?: CrewEvent; task?: string };
export type Session = { agent: string; pid: number; started: string; task: string | null; log: string };

const sessionsPath = (c: Crew) => c.p(".state", "sessions.json");
const pausedPath = (c: Crew) => c.p(".state", "paused");

export function activeSessions(c: Crew): Session[] {
  return readJson<Session[]>(sessionsPath(c), []).filter((s) => pidAlive(s.pid));
}
export const isPaused = (c: Crew): boolean => existsSync(pausedPath(c));

// Launch a detached session process for an agent. Returns immediately.
export function launch(c: Crew, agent: string, w: Wake): void {
  const dir = c.p(".state", "wakes");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${agent}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(w));
  const child = spawn(process.execPath, [...SELF_ARGS, "session", agent, file], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CREW_VAULT: c.vault },
  });
  child.on("error", (e) => {
    emit(c, { type: "agent.error", by: "crew", agent, data: { reason: `couldn't start session: ${e.message}` } });
  });
  child.unref();
}

export function wakeCmd(c: Crew, a: Args, o: Out): void {
  const name = a._[1];
  if (!name) throw new CrewError("Usage: crew wake <agent> [--task id] [--reason text]");
  const ag = getAgent(c, name);
  if (!ag.def.enabled) throw new CrewError(`${name} is disabled. Run "crew agent enable ${name}" first.`);
  if (activeSessions(c).some((s) => s.agent === name)) return o.say(`${name} is already running.`);
  launch(c, name, { reason: flag(a, "reason") ?? `woken by ${actorOf(a)}`, task: flag(a, "task") });
  o.say(`Waking ${name}.`);
}

function readIf(p: string, max = 6000): string {
  if (!existsSync(p)) return "";
  const t = readFileSync(p, "utf8");
  return t.length > max ? `${t.slice(0, max)}\n...(truncated)` : t;
}

export function buildPrompt(c: Crew, ag: Agent, w: Wake, taskId: string | null): string {
  const parts: string[] = [];
  parts.push(
    `You are "${ag.name}", an agent on the crew team in the Obsidian vault at ${c.vault}.`,
    "Use the `crew` CLI for all shared state: tasks, claims, posts, events, jobs, logs. Your identity is already set (CREW_AGENT).",
    `If \`crew\` isn't on PATH, run it as: "${process.execPath}"${SELF_ARGS[0] ? ` "${SELF_ARGS[0]}"` : ""} <command>.`,
    "Follow the standard workflow in your definition. Never wait inside this session for long work: start a job with `crew job run` and end the session.",
    "",
    "## Why you woke",
    w.reason,
  );
  if (w.event) parts.push("```json", JSON.stringify(w.event, null, 2), "```");
  if (taskId) {
    const tp = c.p("tasks", `${taskId}.md`);
    if (existsSync(tp)) parts.push("", `## Task ${taskId}`, readIf(tp));
  }
  const job = w.event?.data?.job;
  if (typeof job === "string") parts.push("", `## Your job note for ${job}`, readIf(c.p("jobs", job, "job.md")));
  parts.push("", "## Your definition (agent.md)", ag.raw);
  parts.push("", "## Your memory (memory.md)", readIf(join(ag.dir, "memory.md")) || "(empty)");
  for (const w2 of ag.def.wiki ?? []) {
    const wp = c.p("wiki", `${w2}.md`);
    if (existsSync(wp)) parts.push("", `## Wiki: ${w2}`, readIf(wp, 4000));
  }
  const sd = join(ag.dir, "skills", "scripts");
  const scripts = existsSync(sd) ? readdirSync(sd) : [];
  parts.push("", "## Your scripts (check before writing a new one)", scripts.length ? scripts.map((s) => `- skills/scripts/${s}`).join("\n") : "(none yet)");
  return parts.join("\n");
}

function budgetBlocked(c: Crew, ag: Agent): string | null {
  const s = spendToday(c);
  const mine = s[ag.name] ?? 0;
  const total = Object.values(s).reduce((x, y) => x + y, 0);
  const cap = ag.def.budget?.daily_usd;
  const crewCap = c.config().budget?.crew_daily_usd;
  if (cap !== undefined && mine >= cap) return `${ag.name} reached its daily budget ($${mine.toFixed(2)} of $${cap})`;
  if (crewCap !== undefined && total >= crewCap) return `the team reached its daily budget ($${total.toFixed(2)} of $${crewCap})`;
  return null;
}

// Internal: `crew session <agent> <wake.json>`. Runs one agent session in the foreground (launched detached).
export async function sessionRun(c: Crew, name: string, wakeFile: string): Promise<void> {
  const w = readJson<Wake>(wakeFile, { reason: "manual" });
  rmSync(wakeFile, { force: true });
  const ag = getAgent(c, name);
  if (!ag.def.enabled || isPaused(c)) return;
  const blocked = budgetBlocked(c, ag);
  if (blocked) {
    const flagFile = c.p(".state", `budget-${today()}-${name}`);
    if (!existsSync(flagFile)) {
      writeFileSync(flagFile, blocked);
      emit(c, { type: "budget.exceeded", by: "crew", agent: name, data: { reason: blocked } });
      agentLog(c, name, `paused: ${blocked}`);
    }
    return;
  }
  const runner = c.config().runners?.[ag.def.runner];
  if (!runner || ag.def.runner === "none") {
    agentLog(c, name, `no runner configured ("${ag.def.runner}"), session skipped`);
    return;
  }
  if (!Bun.which(runner.cmd)) {
    emit(c, { type: "agent.error", by: "crew", agent: name, data: { reason: `runner command "${runner.cmd}" not found` } });
    agentLog(c, name, `runner command "${runner.cmd}" not found`);
    return;
  }
  const taskId = w.task ?? w.event?.task ?? null;
  const task = taskId ? listTasks(c).find((t) => t.id === taskId) : undefined;
  const cwd = task?.worktree && existsSync(task.worktree) ? task.worktree : ag.dir;
  const prompt = buildPrompt(c, ag, w, taskId);
  const args = runner.args.map((x) => x.replaceAll("{{prompt}}", prompt).replaceAll("{{model}}", ag.def.model ?? ""));
  const logDir = c.p(".state", "sessions");
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

  const ok = await withMutex(c, () => {
    const live = activeSessions(c);
    if (live.some((s) => s.agent === name)) return false;
    live.push({ agent: name, pid: process.pid, started: new Date().toISOString(), task: taskId, log });
    writeJson(sessionsPath(c), live);
    return true;
  });
  if (!ok) return;

  emit(c, { type: "session.started", by: "crew", agent: name, task: taskId ?? undefined, data: { reason: w.reason } });
  agentLog(c, name, `session started: ${w.reason}`, taskId);
  const fd = openSync(log, "a");
  const exit = await new Promise<number>((res) => {
    const child = spawn(runner.cmd, args, {
      cwd,
      stdio: ["ignore", fd, fd],
      env: {
        ...process.env,
        CREW_VAULT: c.vault,
        CREW_AGENT: name,
        CREW_TASK: taskId ?? "",
        CREW_BUN: process.execPath,
        CREW_CLI: SELF_ARGS[0] ?? "",
      },
    });
    child.on("error", () => res(127));
    child.on("exit", (code) => res(code ?? 1));
  });
  closeSync(fd);

  if (runner.cost_from_json) {
    try {
      const out = JSON.parse(readFileSync(log, "utf8").trim().split("\n").at(-1) ?? "{}") as { total_cost_usd?: number };
      if (typeof out.total_cost_usd === "number") addSpend(c, name, out.total_cost_usd);
    } catch {
      /* runner didn't print JSON; spend can be recorded with crew spend */
    }
  }
  await withMutex(c, () => writeJson(sessionsPath(c), activeSessions(c).filter((s) => s.pid !== process.pid)));
  emit(c, { type: "session.ended", by: "crew", agent: name, task: taskId ?? undefined, data: { exit, log } });
  agentLog(c, name, `session ended (exit ${exit})`, taskId);
}

// ---------- status ----------
export function serverInfo(c: Crew): { running: boolean; pid?: number; port?: number; started?: string } {
  const s = readJson<{ pid?: number; port?: number; started?: string }>(c.p(".state", "server.json"), {});
  return { running: pidAlive(s.pid), ...s };
}

function lastLogLine(c: Crew, name: string): string {
  const f = c.p("agents", name, "logs", `${today()}.md`);
  if (!existsSync(f)) return "";
  const lines = readFileSync(f, "utf8").trim().split("\n").filter((l) => l.startsWith("- "));
  return lines.at(-1)?.slice(2) ?? "";
}

export function statusData(c: Crew) {
  const sessions = activeSessions(c);
  const jobs = listJobs(c);
  const tasks = listTasks(c);
  const spend = spendToday(c);
  const agents = listAgents(c).map((ag) => {
    const running = sessions.some((s) => s.agent === ag.name);
    const waitingJob = jobs.some((j) => j.agent === ag.name && ["queued", "waiting", "running"].includes(j.status));
    const owned = tasks.find((t) => t.claimed_by === ag.name && t.status === "claimed");
    const blocked = tasks.some((t) => t.claimed_by === ag.name && t.status === "blocked");
    const state = !ag.def.enabled ? "disabled" : running ? "running" : waitingJob ? "sleeping" : blocked ? "blocked" : "idle";
    return {
      name: ag.name,
      state,
      runner: ag.def.runner,
      model: ag.def.model ?? "",
      task: owned?.id ?? null,
      lastLog: lastLogLine(c, ag.name),
      spend: spend[ag.name] ?? 0,
      can: ag.def.can ?? [],
    };
  });
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
  const sampled = tasks.filter((t) => t.sampled && !t.sampled_ack).length;
  return {
    server: serverInfo(c),
    paused: isPaused(c),
    agents,
    tasks: counts,
    review: (counts.review ?? 0) + sampled,
    jobs: jobs.filter((j) => ["queued", "waiting", "running"].includes(j.status)).length,
    locks: readLocks(c),
    spend: Object.values(spend).reduce((x, y) => x + y, 0),
  };
}

export function statusCmd(c: Crew, o: Out): void {
  const s = statusData(c);
  o.json = s;
  o.say(`crew server: ${s.server.running ? `running on port ${s.server.port} (pid ${s.server.pid})` : "not running"}${s.paused ? ", PAUSED by kill switch (crew resume to continue)" : ""}`);
  const needs = s.review + (s.tasks.blocked ?? 0);
  o.say(`Needs you: ${s.review} to review, ${s.tasks.blocked ?? 0} blocked${needs ? "" : " (nothing waiting)"}`);
  o.say(`Tasks: ${Object.entries(s.tasks).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  o.say(`Jobs active: ${s.jobs}. Spend today: $${s.spend.toFixed(2)}`);
  for (const a of s.agents)
    o.say(`  ${a.name.padEnd(14)} ${a.state.padEnd(8)} ${(a.task ?? "-").padEnd(7)} $${a.spend.toFixed(2)}  ${a.lastLog.slice(0, 70)}`);
}

// ---------- kill switch ----------
export async function stopAll(c: Crew, a: Args, o: Out): Promise<void> {
  const who = actorOf(a);
  writeFileSync(pausedPath(c), new Date().toISOString());
  for (const s of activeSessions(c)) {
    try {
      process.kill(-s.pid, "SIGTERM");
    } catch {
      try {
        process.kill(s.pid, "SIGTERM");
      } catch {
        /* gone */
      }
    }
  }
  for (const j of listJobs(c).filter((x) => ["queued", "waiting", "running"].includes(x.status))) await jobKill(c, j.id, o, who);
  await withMutex(c, () => {
    writeJson(sessionsPath(c), []);
    for (const t of listTasks(c).filter((x) => x.status === "claimed" && x.claimed_by !== "human"))
      releaseTask(c, t.id, who, "kill switch");
    emit(c, { type: "crew.stopped", by: who });
  });
  o.say("Everything stopped: sessions ended, jobs killed, locks released, agent claims back to ready. Run \"crew resume\" to let agents wake again.");
}

export function resume(c: Crew, a: Args, o: Out): void {
  rmSync(pausedPath(c), { force: true });
  emit(c, { type: "crew.resumed", by: actorOf(a) });
  o.say("Resumed. Agents will wake on events again.");
}

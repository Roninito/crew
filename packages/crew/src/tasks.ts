// Tasks: one note per task. The board is a view over these notes.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import {
  type Args,
  type Crew,
  CrewError,
  type Md,
  type Out,
  actorOf,
  agentLog,
  basename,
  emit,
  flag,
  flags,
  has,
  join,
  list,
  nextId,
  readMd,
  resolve,
  stamp,
  writeMd,
} from "./core";

export const STATUSES = ["inbox", "ready", "claimed", "verify", "review", "done", "blocked"] as const;
export type Status = (typeof STATUSES)[number];

export type Task = {
  id: string;
  title: string;
  type: string;
  needs: string[];
  status: Status;
  claimed_by: string | null;
  claim_expires: string | null;
  worker: string | null;
  priority: string;
  acceptance: string[];
  checks: string[];
  target: string | null;
  parent: string | null;
  worktree: string | null;
  protected: boolean;
  recommendation: string | null;
  approvals: string[];
  rejections: number;
  verified_by: string | null;
  sampled: boolean;
  sampled_ack: boolean;
  created: string;
};

export const taskPath = (c: Crew, id: string) => c.p("tasks", `${id}.md`);

export function loadTask(c: Crew, id: string): { t: Task; md: Md } {
  const p = taskPath(c, id);
  if (!existsSync(p)) throw new CrewError(`No task ${id}.`);
  const md = readMd(p);
  return { t: md.data as Task, md };
}

export function saveTask(c: Crew, t: Task, md: Md): void {
  md.data = t;
  writeMd(taskPath(c, t.id), md);
}

export function listTasks(c: Crew): Task[] {
  const d = c.p("tasks");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => /^T-\d+\.md$/.test(f))
    .sort()
    .map((f) => readMd(join(d, f)).data as Task);
}

export function addNote(md: Md, who: string, text: string): void {
  if (!md.body.includes("## Notes")) md.body = `${md.body.trimEnd()}\n\n## Notes\n`;
  md.body = `${md.body.trimEnd()}\n- ${stamp()} **${who}**: ${text}\n`;
}

function isProtected(c: Crew, tags: string[]): boolean {
  const prot = c.config().protected ?? [];
  return tags.some((t) => prot.includes(t));
}

export function taskNew(c: Crew, a: Args, o: Out): void {
  const title = a._.slice(2).join(" ").trim();
  if (!title) throw new CrewError('Usage: crew task new "<title>" --needs a,b --accept "..." [--check "cmd"]');
  const id = nextId(c, "T");
  const acceptance = flags(a, "accept");
  const tags = list(flag(a, "tags"));
  const t: Task = {
    id,
    title,
    type: flag(a, "type") ?? "general",
    needs: list(flag(a, "needs")),
    status: acceptance.length ? "ready" : "inbox",
    claimed_by: null,
    claim_expires: null,
    worker: null,
    priority: flag(a, "priority") ?? "normal",
    acceptance,
    checks: flags(a, "check"),
    target: flag(a, "target") ?? null,
    parent: flag(a, "parent") ?? null,
    worktree: null,
    protected: has(a, "protected") || isProtected(c, tags),
    recommendation: null,
    approvals: [],
    rejections: 0,
    verified_by: null,
    sampled: false,
    sampled_ack: false,
    created: new Date().toISOString(),
  };
  const desc = flag(a, "desc") ?? "";
  const md: Md = { data: {}, body: `\n# ${title}\n\n${desc}\n\n## Notes\n` };
  saveTask(c, t, md);
  const who = actorOf(a);
  emit(c, { type: "task.created", by: who, task: id, data: { needs: t.needs, type: t.type } });
  if (t.status === "ready") emit(c, { type: "task.ready", by: who, task: id, data: { needs: t.needs } });
  o.json = t;
  o.say(`${id} created (${t.status})${t.status === "inbox" ? ". Add --accept criteria to make it ready." : ""}`);
}

export function taskList(c: Crew, a: Args, o: Out): void {
  const want = list(flag(a, "status"));
  const ts = listTasks(c).filter((t) => !want.length || want.includes(t.status));
  o.json = ts;
  if (!ts.length) return o.say("No tasks.");
  for (const t of ts)
    o.say(`${t.id}  ${t.status.padEnd(7)}  ${(t.claimed_by ?? "-").padEnd(12)}  ${t.title}  [${t.needs.join(",")}]`);
}

export function taskShow(c: Crew, id: string, o: Out): void {
  if (!id) throw new CrewError("Usage: crew task show <id>");
  const { t, md } = loadTask(c, id);
  o.json = { ...t, body: md.body };
  o.say(`${t.id}: ${t.title}`);
  o.say(`status ${t.status}, owner ${t.claimed_by ?? "-"}, type ${t.type}, needs ${t.needs.join(",") || "-"}`);
  if (t.worktree) o.say(`work tree ${t.worktree}`);
  o.say("acceptance:");
  for (const x of t.acceptance) o.say(`  - ${x}`);
  if (t.checks.length) o.say(`checks: ${t.checks.join(" | ")}`);
  o.say(md.body.trim());
}

export function taskUpdate(c: Crew, a: Args, o: Out): void {
  const id = a._[2];
  if (!id) throw new CrewError("Usage: crew task update <id> [--status s] [--note text] [--accept text]");
  const { t, md } = loadTask(c, id);
  const who = actorOf(a);
  for (const x of flags(a, "accept")) t.acceptance.push(x);
  for (const x of flags(a, "check")) t.checks.push(x);
  if (flag(a, "needs")) t.needs = list(flag(a, "needs"));
  if (flag(a, "target")) t.target = flag(a, "target")!;
  if (flag(a, "type")) t.type = flag(a, "type")!;
  const note = flag(a, "note");
  if (note) {
    addNote(md, who, note);
    agentLog(c, who, note, id);
  }
  const status = flag(a, "status") as Status | undefined;
  if (status) {
    if (!STATUSES.includes(status)) throw new CrewError(`Unknown status "${status}". Use ${STATUSES.join(", ")}.`);
    if (!["inbox", "blocked"].includes(status) && !t.acceptance.length)
      throw new CrewError(`${id} has no acceptance criteria. Add --accept "..." before it can leave inbox.`);
    const prev = t.status;
    t.status = status;
    if (status === "ready") {
      t.claimed_by = null;
      t.claim_expires = null;
      emit(c, { type: "task.ready", by: who, task: id, data: { needs: t.needs } });
    }
    if (status === "verify") {
      t.worker = t.claimed_by ?? who;
      t.approvals = [];
      emit(c, { type: "task.verify", by: who, task: id, agent: t.worker, data: { type: t.type } });
    }
    if (status === "blocked") emit(c, { type: "task.blocked", by: who, task: id, data: { note: note ?? "" } });
    o.say(`${id}: ${prev} -> ${status}`);
  }
  saveTask(c, t, md);
  emit(c, { type: "task.updated", by: who, task: id, data: { status: t.status } });
  o.json = t;
  if (!status) o.say(`${id} updated.`);
}

// Isolated space for a task: a git worktree for code (when project.repo is set), else a staging folder.
export function ensureWorktree(c: Crew, t: Task): string {
  const dir = join(c.worktreeBase(), t.id);
  if (!existsSync(dir)) {
    mkdirSync(c.worktreeBase(), { recursive: true });
    const repo = c.config().project?.repo;
    if (t.type === "code" && repo) {
      const r = spawnSync("git", ["-C", c.expand(repo), "worktree", "add", "-b", `crew/${t.id}`, dir], {
        encoding: "utf8",
      });
      if (r.status !== 0) throw new CrewError(`git worktree failed: ${r.stderr.trim()}`);
    } else {
      mkdirSync(dir, { recursive: true });
      // Seed the staging area with whatever's already at target, so a worker editing an existing
      // file (like an append-only log) can see and preserve what's there instead of unknowingly
      // starting from nothing -- and so approval's copy-back doesn't wipe out prior content.
      if (t.target) {
        const existing = resolve(c.vault, c.expand(t.target));
        if (existsSync(existing)) cpSync(existing, join(dir, basename(t.target)), { recursive: true });
      }
    }
  }
  mkdirSync(c.p("worktrees"), { recursive: true });
  writeFileSync(
    c.p("worktrees", `${t.id}.md`),
    `---\ntask: ${t.id}\npath: "${dir}"\nkind: ${t.type === "code" && c.config().project?.repo ? "git" : "staging"}\n---\n\n[[${t.id}]] work tree at \`${dir}\`\n`,
  );
  return dir;
}

export function claim(c: Crew, a: Args, o: Out): void {
  const id = a._[1];
  if (!id) throw new CrewError("Usage: crew claim <task-id> [--as human]");
  const who = actorOf(a);
  const { t, md } = loadTask(c, id);
  const live = t.claimed_by && (!t.claim_expires || Date.parse(t.claim_expires) > Date.now());
  if (t.status !== "ready" && !(t.status === "claimed" && !live))
    throw new CrewError(`${id} is ${t.status}${t.claimed_by ? ` (claimed by ${t.claimed_by})` : ""}; only ready tasks can be claimed.`);
  if (who !== "human") {
    const agentMd = c.p("agents", who, "agent.md");
    if (existsSync(agentMd)) {
      const can: string[] = readMd(agentMd).data.can ?? [];
      const missing = t.needs.filter((n) => !can.includes(n));
      if (missing.length) throw new CrewError(`${who} can't take ${id}: missing ${missing.join(", ")}.`);
    }
  }
  const minutes = c.config().limits?.claim_minutes ?? 30;
  t.status = "claimed";
  t.claimed_by = who;
  t.claim_expires = who === "human" ? null : new Date(Date.now() + minutes * 6e4).toISOString();
  t.worktree = ensureWorktree(c, t);
  addNote(md, who, "claimed");
  saveTask(c, t, md);
  agentLog(c, who, `claimed ${t.title}`, id);
  emit(c, { type: "task.claimed", by: who, task: id, agent: who, data: { worktree: t.worktree } });
  o.json = t;
  o.say(`${id} claimed by ${who}. Work tree: ${t.worktree}`);
}

export function release(c: Crew, a: Args, o: Out, reason = "released"): void {
  const id = a._[1];
  if (!id) throw new CrewError("Usage: crew release <task-id>");
  releaseTask(c, id, actorOf(a), reason);
  o.say(`${id} back to ready.`);
}

export function releaseTask(c: Crew, id: string, by: string, reason: string): void {
  const { t, md } = loadTask(c, id);
  const prev = t.claimed_by;
  t.status = "ready";
  t.claimed_by = null;
  t.claim_expires = null;
  addNote(md, by, `released (${reason})`);
  saveTask(c, t, md);
  emit(c, { type: "task.released", by, task: id, agent: prev ?? undefined, data: { reason } });
  emit(c, { type: "task.ready", by, task: id, data: { needs: t.needs } });
}

export function renew(c: Crew, a: Args, o: Out): void {
  const id = a._[1] ?? process.env.CREW_TASK;
  if (!id) throw new CrewError("Usage: crew renew <task-id>");
  const { t, md } = loadTask(c, id);
  if (t.status !== "claimed") return o.say(`${id} isn't claimed; nothing to renew.`);
  if (t.claimed_by !== "human") {
    t.claim_expires = new Date(Date.now() + (c.config().limits?.claim_minutes ?? 30) * 6e4).toISOString();
    saveTask(c, t, md);
  }
  o.say(`${id} claim renewed until ${t.claim_expires ?? "released by the human"}.`);
}

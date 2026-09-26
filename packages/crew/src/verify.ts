// Verification: verdicts with a trust policy, audits against acceptance criteria, and trace timelines.
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  type Args,
  type Crew,
  CrewError,
  type Out,
  actorOf,
  agentLog,
  basename,
  dirname,
  emit,
  flag,
  join,
  readEvents,
  readJson,
  resolve,
  stamp,
  tail,
  withMutex,
  writeJson,
} from "./core";
import { listJobs } from "./jobs";
import { type Task, addNote, loadTask, saveTask } from "./tasks";

type Stats = Record<string, { reviewed: number; agreed: number }>;
const statsPath = (c: Crew) => c.p(".state", "verifier-stats.json");
export const readStats = (c: Crew): Stats => readJson<Stats>(statsPath(c), {});

function recordAgreement(c: Crew, type: string, agreed: boolean): void {
  const s = readStats(c);
  const cur = s[type] ?? { reviewed: 0, agreed: 0 };
  cur.reviewed++;
  if (agreed) cur.agreed++;
  s[type] = cur;
  writeJson(statsPath(c), s);
}

// Tier sets the ceiling for a task type; the human's track record with the verifier decides when it's reached.
export function policyFor(c: Crew, t: Task): { auto: boolean; secondOpinion: boolean; reason: string } {
  const v = c.config().verify ?? {};
  if (t.protected) return { auto: false, secondOpinion: false, reason: "protected area, always goes to the human" };
  const tier = v.tiers?.[t.type] ?? v.tiers?.default ?? "human";
  if (tier === "human") return { auto: false, secondOpinion: false, reason: `tier for "${t.type}" is human` };
  const s = readStats(c)[t.type] ?? { reviewed: 0, agreed: 0 };
  const need = v.earn_after ?? 20;
  const rate = s.reviewed ? s.agreed / s.reviewed : 0;
  const bar = v.earn_agreement ?? 0.95;
  if (s.reviewed < need || rate < bar)
    return {
      auto: false,
      secondOpinion: false,
      reason: `"${t.type}" hasn't earned auto-approval yet (${s.agreed}/${s.reviewed} agreed, needs ${need} reviews at ${Math.round(bar * 100)}%)`,
    };
  return { auto: true, secondOpinion: tier === "auto-second-opinion", reason: "earned" };
}

function applyApproval(c: Crew, t: Task): string {
  if (!t.worktree || !existsSync(t.worktree)) return "no work tree to merge";
  const repo = c.config().project?.repo;
  if (t.type === "code" && repo) {
    const r = c.expand(repo);
    const m = spawnSync("git", ["-C", r, "merge", "--no-ff", `crew/${t.id}`, "-m", `${t.id}: ${t.title}`], { encoding: "utf8" });
    if (m.status !== 0) throw new CrewError(`Merge failed, task left in place: ${m.stderr.trim() || m.stdout.trim()}`);
    spawnSync("git", ["-C", r, "worktree", "remove", t.worktree], { encoding: "utf8" });
    return `merged crew/${t.id} into ${r}`;
  }
  if (t.target) {
    // resolve() anchors to the vault root regardless of the crew process's own cwd -- expand()
    // alone only substitutes ${VAR} placeholders, so a plain relative target like "Blog.md"
    // would otherwise land wherever the process happened to be running from (unpredictable when
    // approval runs through a long-lived server rather than a terminal already cd'd into the
    // vault). Copying the specific file/dir named by target's basename, not the whole work tree,
    // matters just as much: target is one file (or one folder of produced assets), and the work
    // tree is a staging area that can hold notes, scratch files, or job output alongside it.
    const dest = resolve(c.vault, c.expand(t.target));
    const src = join(t.worktree, basename(t.target));
    if (!existsSync(src)) throw new CrewError(`Work tree has no ${basename(t.target)} -- nothing to copy to ${t.target}.`);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
    return `copied ${basename(t.target)} to ${dest}`;
  }
  return "approved in place (no target set)";
}

function approve(c: Crew, t: Task, md: ReturnType<typeof loadTask>["md"], by: string, reason: string): void {
  const how = applyApproval(c, t);
  const rate = c.config().verify?.sample_rate ?? 0.1;
  t.status = "done";
  t.claimed_by = null;
  t.claim_expires = null;
  t.verified_by = by;
  t.sampled = by !== "human" && Math.random() < rate;
  addNote(md, by, `approved: ${reason || "checks pass"} (${how})${t.sampled ? ", sampled for human review" : ""}`);
  saveTask(c, t, md);
  emit(c, { type: "review.approved", by, task: t.id, agent: t.worker ?? undefined, data: { how, sampled: t.sampled } });
}

// crew verdict <id> approve|reject|escalate|agree|disagree --reason "..." [--recommend approve|reject]
export function verdict(c: Crew, a: Args, o: Out): void {
  const [, id, action] = a._;
  const who = actorOf(a);
  const reason = flag(a, "reason") ?? "";
  if (!id || !action) throw new CrewError("Usage: crew verdict <task-id> approve|reject|escalate|agree|disagree --reason \"...\"");
  const { t, md } = loadTask(c, id);

  if (action === "agree" || action === "disagree") {
    if (who !== "human") throw new CrewError("Only the human agrees or disagrees with sampled approvals.");
    if (!t.sampled) throw new CrewError(`${id} wasn't sampled for review.`);
    t.sampled_ack = true;
    recordAgreement(c, t.type, action === "agree");
    addNote(md, who, `${action}s with the verifier${reason ? `: ${reason}` : ""}`);
    saveTask(c, t, md);
    if (action === "disagree" && t.verified_by) {
      appendFileSync(c.p("agents", t.verified_by, "memory.md"), `- ${stamp()} [[${id}]] Human disagreed with my approval: ${reason || "no reason given"}\n`);
    }
    emit(c, { type: `review.${action}`, by: who, task: id, agent: t.verified_by ?? undefined, data: { reason } });
    return o.say(`${id}: recorded ${action}.`);
  }

  if (action === "approve") {
    if (who === "human") {
      if (!["verify", "review", "claimed"].includes(t.status)) throw new CrewError(`${id} is ${t.status}; nothing to approve.`);
      if (t.recommendation) recordAgreement(c, t.type, t.recommendation === "approve");
      approve(c, t, md, who, reason);
      return o.say(`${id} approved.`);
    }
    if (t.status !== "verify") throw new CrewError(`${id} is ${t.status}; agents can only approve tasks in verify.`);
    if (t.worker === who) throw new CrewError("An agent can't approve its own work.");
    const p = policyFor(c, t);
    if (!p.auto) {
      t.status = "review";
      t.recommendation = "approve";
      t.verified_by = who;
      addNote(md, who, `recommends approve${reason ? `: ${reason}` : ""}. Escalated: ${p.reason}.`);
      saveTask(c, t, md);
      emit(c, { type: "review.escalated", by: who, task: id, data: { recommendation: "approve", reason: p.reason } });
      return o.say(`${id} escalated to the human (${p.reason}).`);
    }
    if (!t.approvals.includes(who)) t.approvals.push(who);
    if (p.secondOpinion && t.approvals.length < 2) {
      addNote(md, who, `approves${reason ? `: ${reason}` : ""}; waiting for a second opinion`);
      saveTask(c, t, md);
      emit(c, { type: "task.verify", by: who, task: id, data: { type: t.type, second_opinion: true, first: who } });
      return o.say(`${id}: first approval recorded, second opinion requested.`);
    }
    approve(c, t, md, who, reason);
    return o.say(`${id} approved${t.sampled ? " and sampled for human review" : ""}.`);
  }

  if (action === "reject") {
    if (!reason) throw new CrewError("A rejection needs --reason so the worker knows what to fix.");
    if (who !== "human" && t.worker === who) throw new CrewError("An agent can't reject its own work.");
    if (who === "human" && t.recommendation) recordAgreement(c, t.type, t.recommendation === "reject");
    t.rejections++;
    if (who !== "human" && t.rejections >= 2) {
      t.status = "review";
      t.recommendation = "reject";
      addNote(md, who, `rejected again (${reason}). Escalated after ${t.rejections} rejections.`);
      saveTask(c, t, md);
      emit(c, { type: "review.escalated", by: who, task: id, data: { recommendation: "reject", reason } });
      return o.say(`${id} escalated after repeated rejections.`);
    }
    const worker = t.worker ?? t.claimed_by;
    t.status = worker ? "claimed" : "ready";
    t.claimed_by = worker;
    t.claim_expires = worker && worker !== "human" ? new Date(Date.now() + (c.config().limits?.claim_minutes ?? 30) * 6e4).toISOString() : null;
    t.recommendation = null;
    addNote(md, who, `rejected: ${reason}`);
    saveTask(c, t, md);
    emit(c, { type: "review.rejected", by: who, task: id, agent: worker ?? undefined, data: { reason } });
    return o.say(`${id} rejected and returned to ${worker ?? "the board"}.`);
  }

  if (action === "escalate") {
    t.status = "review";
    t.recommendation = flag(a, "recommend") ?? null;
    t.verified_by = who;
    addNote(md, who, `escalated: ${reason || "needs human judgment"}${t.recommendation ? ` (recommends ${t.recommendation})` : ""}`);
    saveTask(c, t, md);
    emit(c, { type: "review.escalated", by: who, task: id, data: { recommendation: t.recommendation, reason } });
    return o.say(`${id} escalated to the human.`);
  }
  throw new CrewError(`Unknown verdict "${action}".`);
}

// Runs the task's checks in its work tree and reports each acceptance line.
export async function audit(c: Crew, a: Args, o: Out): Promise<void> {
  const id = a._[1];
  if (!id) throw new CrewError("Usage: crew audit <task-id>");
  const { t } = loadTask(c, id);
  const cwd = t.worktree && existsSync(t.worktree) ? t.worktree : c.vault;
  const results = t.checks.map((cmd) => {
    const r = spawnSync("bash", ["-lc", cmd], {
      cwd,
      encoding: "utf8",
      timeout: 300_000,
      env: { ...process.env, CREW_VAULT: c.vault, CREW_TASK: id },
    });
    return { cmd, pass: r.status === 0, output: tail(`${r.stdout ?? ""}${r.stderr ?? ""}`.trim(), 15) };
  });
  const passed = results.filter((r) => r.pass).length;
  o.json = { task: id, checks: results, acceptance: t.acceptance, cwd };
  o.say(`Audit of ${id}: ${t.title}`);
  o.say(`work tree: ${cwd}`);
  o.say("Acceptance criteria (compare against the evidence below):");
  for (const x of t.acceptance) o.say(`  - ${x}`);
  if (!results.length) o.say("No automated checks on this task, so every criterion needs judgment.");
  for (const r of results) {
    o.say(`${r.pass ? "PASS" : "FAIL"}  ${r.cmd}`);
    if (r.output) o.say(r.output.split("\n").map((l) => `      ${l}`).join("\n"));
  }
  await withMutex(c, () => {
    const cur = loadTask(c, id);
    addNote(cur.md, actorOf(a), `audit: ${passed}/${results.length} checks passed`);
    saveTask(c, cur.t, cur.md);
  });
  if (passed < results.length) o.code = 1;
}

// Writes crew/traces/<id>.md: one timeline of everything that touched the task.
export function trace(c: Crew, a: Args, o: Out): void {
  const id = a._[1];
  if (!id) throw new CrewError("Usage: crew trace <task-id>");
  const { t } = loadTask(c, id);
  const rows: { ts: string; line: string }[] = [];
  for (const e of readEvents(c).filter((x) => x.task === id)) {
    const job = e.data?.job ? ` [[crew/jobs/${String(e.data.job)}/job|${String(e.data.job)}]]` : "";
    const why = e.data?.reason ? ` (${String(e.data.reason)})` : "";
    rows.push({ ts: e.ts, line: `\`${e.type}\` by **${e.by}**${job}${why}` });
  }
  const bb = c.p("blackboard");
  if (existsSync(bb))
    for (const f of readdirSync(bb)) {
      const raw = readFileSync(join(bb, f), "utf8");
      if (raw.includes(`[[${id}]]`)) {
        const ts = raw.match(/^ts: (.+)$/m)?.[1] ?? "";
        rows.push({ ts, line: `post: [[crew/blackboard/${f.replace(/\.md$/, "")}|${raw.split("\n").at(-2)?.slice(0, 80)}]]` });
      }
    }
  rows.sort((x, y) => x.ts.localeCompare(y.ts));
  const jobs = listJobs(c).filter((j) => j.task === id);
  const body = [
    `---\ntask: ${id}\ngenerated: ${new Date().toISOString()}\n---\n`,
    `# Trace for [[${id}]]: ${t.title}\n`,
    `Status **${t.status}**, worker ${t.worker ?? t.claimed_by ?? "none"}, verified by ${t.verified_by ?? "nobody yet"}.\n`,
    "## Timeline\n",
    ...rows.map((r) => `- ${r.ts.slice(0, 16).replace("T", " ")} ${r.line}`),
    "\n## Jobs\n",
    ...(jobs.length ? jobs.map((j) => `- [[crew/jobs/${j.id}/job|${j.id}]] ${j.status}, exit ${j.exit ?? "-"}, ${j.script.split("/").pop()}`) : ["- none"]),
    `\n## Work tree\n\n${t.worktree ? `\`${t.worktree}\`` : "none"}\n`,
  ].join("\n");
  mkdirSync(c.p("traces"), { recursive: true });
  const out = c.p("traces", `${id}.md`);
  writeFileSync(out, body);
  agentLog(c, actorOf(a), "built trace", id);
  o.json = { path: out };
  o.say(`Trace written to ${out}`);
}

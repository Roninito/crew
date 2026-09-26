// Blackboard posts, raw events, logs, and spend tracking.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  type Args,
  type Crew,
  CrewError,
  type Out,
  actorOf,
  agentLog,
  emit,
  flag,
  has,
  join,
  parseDuration,
  readEvents,
  readJson,
  today,
  writeJson,
} from "./core";

export function post(c: Crew, a: Args, o: Out): void {
  const msg = a._.slice(1).join(" ").trim();
  if (!msg) throw new CrewError('Usage: crew post "<message>" [--task T-0001] [--topic name]');
  const who = actorOf(a);
  const task = flag(a, "task") ?? process.env.CREW_TASK ?? null;
  const topic = flag(a, "topic") ?? "general";
  const ts = new Date().toISOString();
  const file = c.p("blackboard", `${ts.replace(/[:.]/g, "-")}-${who}.md`);
  writeFileSync(
    file,
    `---\nby: ${who}\nts: ${ts}\ntopic: ${topic}\ntask: ${task ?? "null"}\n---\n\n${task ? `[[${task}]] ` : ""}${msg}\n`,
  );
  emit(c, { type: "blackboard.posted", by: who, task: task ?? undefined, data: { topic, message: msg } });
  o.say("Posted.");
}

export function emitCmd(c: Crew, a: Args, o: Out): void {
  const type = a._[1];
  if (!type || !/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(type))
    throw new CrewError("Usage: crew emit <domain.event> [--task id] [--data '{json}']  (event names look like asset.ready)");
  let data: Record<string, unknown> | undefined;
  const raw = flag(a, "data");
  if (raw) {
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new CrewError("--data must be valid JSON.");
    }
  }
  const ev = emit(c, {
    type,
    by: actorOf(a),
    task: flag(a, "task") ?? process.env.CREW_TASK,
    agent: flag(a, "agent"),
    data,
  });
  o.json = ev;
  o.say(`Emitted ${type} (${ev.id}).`);
}

export function logCmd(c: Crew, a: Args, o: Out): void {
  const text = a._.slice(1).join(" ").trim();
  if (!text) throw new CrewError('Usage: crew log "<what you did>" [--task id]');
  agentLog(c, actorOf(a), text, flag(a, "task") ?? process.env.CREW_TASK);
  o.say("Logged.");
}

export function logs(c: Crew, a: Args, o: Out): void {
  const since = Date.now() - parseDuration(flag(a, "since"), 864e5);
  const names = has(a, "all")
    ? existsSync(c.p("agents"))
      ? readdirSync(c.p("agents"))
      : []
    : [a._[1] ?? ""];
  if (!names[0]) throw new CrewError("Usage: crew logs <agent> [--since 2h] | crew logs --all");
  const out: { agent: string; line: string }[] = [];
  for (const name of names) {
    const dir = c.p("agents", name, "logs");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.md$/.test(x)).sort()) {
      const day = f.slice(0, 10);
      if (Date.parse(`${day}T23:59:59Z`) < since) continue;
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        const m = line.match(/^- (\d{2}):(\d{2}) /);
        if (!m) continue;
        const t = new Date(`${day}T${m[1]}:${m[2]}:00`).getTime();
        if (t >= since) out.push({ agent: name, line: `${day} ${line.slice(2)}` });
      }
    }
  }
  o.json = out;
  if (!out.length) return o.say("No log entries in that window.");
  for (const x of out) o.say(names.length > 1 ? `${x.agent}: ${x.line}` : x.line);
}

// ---------- spend ----------
type SpendDay = Record<string, number>;
const spendPath = (c: Crew) => c.p(".state", "spend", `${today()}.json`);

export function addSpend(c: Crew, agent: string, usd: number): void {
  const p = spendPath(c);
  const s = readJson<SpendDay>(p, {});
  s[agent] = (s[agent] ?? 0) + usd;
  writeJson(p, s);
}
export function spendToday(c: Crew): SpendDay {
  return readJson<SpendDay>(spendPath(c), {});
}
export function spendCmd(c: Crew, a: Args, o: Out): void {
  const agent = a._[1];
  const usd = Number(a._[2]);
  if (!agent || Number.isNaN(usd)) {
    const s = spendToday(c);
    o.json = s;
    const total = Object.values(s).reduce((x, y) => x + y, 0);
    for (const [k, v] of Object.entries(s)) o.say(`${k.padEnd(14)} $${v.toFixed(2)}`);
    return o.say(`total          $${total.toFixed(2)}`);
  }
  addSpend(c, agent, usd);
  o.say(`Recorded $${usd.toFixed(2)} for ${agent}.`);
}

export function eventsCmd(c: Crew, a: Args, o: Out): void {
  const since = Date.now() - parseDuration(flag(a, "since"), 36e5);
  const evs = readEvents(c, since);
  const n = Number(flag(a, "limit") ?? 200);
  const out = evs.slice(-n);
  o.json = out;
  for (const e of out)
    o.say(`${e.ts.slice(11, 19)} ${e.type.padEnd(20)} ${e.by.padEnd(12)} ${e.task ?? ""} ${e.data ? JSON.stringify(e.data).slice(0, 80) : ""}`);
}

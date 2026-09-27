// Questions: an agent asks the human something and the human answers in place, without a hand-
// rolled "write it in memory.md, reply with crew wake --reason" workaround. One note per
// question, same shape as tasks.
import { existsSync, readdirSync } from "node:fs";
import { type Args, type Crew, CrewError, type Md, type Out, actorOf, emit, flag, join, nextId, readMd, writeMd } from "./core";

export type Question = {
  id: string;
  agent: string;
  topic: string;
  task: string | null;
  status: "open" | "answered";
  answered_by: string | null;
  answered_at: string | null;
  created: string;
};

export const questionPath = (c: Crew, id: string) => c.p("questions", `${id}.md`);

export function loadQuestion(c: Crew, id: string): { q: Question; md: Md } {
  const p = questionPath(c, id);
  if (!existsSync(p)) throw new CrewError(`No question ${id}.`);
  const md = readMd(p);
  return { q: md.data as Question, md };
}

function saveQuestion(c: Crew, q: Question, md: Md): void {
  md.data = q;
  writeMd(questionPath(c, q.id), md);
}

export function listQuestions(c: Crew): Question[] {
  const d = c.p("questions");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => /^Q-\d+\.md$/.test(f))
    .sort()
    .map((f) => readMd(join(d, f)).data as Question);
}

export function questionNew(c: Crew, a: Args, o: Out): void {
  const topic = a._.slice(2).join(" ").trim();
  const text = flag(a, "text");
  if (!topic || !text) throw new CrewError('Usage: crew question new "<topic>" --text "<question>" [--task id]');
  const who = actorOf(a);
  const id = nextId(c, "Q");
  const q: Question = {
    id,
    agent: who,
    topic,
    task: flag(a, "task") ?? null,
    status: "open",
    answered_by: null,
    answered_at: null,
    created: new Date().toISOString(),
  };
  const md: Md = { data: {}, body: `\n# ${topic}\n\n${text}\n` };
  saveQuestion(c, q, md);
  emit(c, { type: "question.asked", by: who, agent: who, task: q.task ?? undefined, data: { topic } });
  o.json = q;
  o.say(`${id} asked. Waiting on a human answer.`);
}

export function questionList(c: Crew, a: Args, o: Out): void {
  const want = flag(a, "status");
  const qs = listQuestions(c).filter((q) => !want || q.status === want);
  o.json = qs;
  if (!qs.length) return o.say("No questions.");
  for (const q of qs) o.say(`${q.id}  ${q.status.padEnd(8)}  ${q.agent.padEnd(14)}  ${q.topic}`);
}

export function questionShow(c: Crew, id: string, o: Out): void {
  if (!id) throw new CrewError("Usage: crew question show <id>");
  const { q, md } = loadQuestion(c, id);
  o.json = { ...q, body: md.body };
  o.say(`${q.id}: ${q.topic} (asked by ${q.agent}, ${q.status})`);
  o.say(md.body.trim());
}

export function questionAnswer(c: Crew, a: Args, o: Out): void {
  const id = a._[2];
  const text = a._.slice(3).join(" ").trim();
  if (!id || !text) throw new CrewError('Usage: crew question answer <id> "<answer>"');
  const { q, md } = loadQuestion(c, id);
  if (q.status === "answered") throw new CrewError(`${id} was already answered by ${q.answered_by}.`);
  const who = actorOf(a);
  md.body = `${md.body.trimEnd()}\n\n## Answer\n${text}\n`;
  q.status = "answered";
  q.answered_by = who;
  q.answered_at = new Date().toISOString();
  saveQuestion(c, q, md);
  emit(c, { type: "question.answered", by: who, agent: q.agent, task: q.task ?? undefined, data: { answer: text, topic: q.topic } });
  o.json = q;
  o.say(`${id} answered. ${q.agent} will pick it up on its next wake.`);
}

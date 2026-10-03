// TUI data layer: read through the same functions the CLI and HTTP server already
// call (no new data-access layer), and write through run() in-process -- the third
// caller alongside bin/crew.ts dispatch and the HTTP /cmd route. run() already
// applies withMutex to mutating commands, so never wrap act() in withMutex.
import { run } from "../commands";
import { logs } from "../comms";
import { Crew, Out, parseArgs, readEvents, type CrewEvent } from "../core";
import { getAgent, listAgents, type Agent } from "../agents";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listQuestions, type Question } from "../questions";
import { listProjects, type ProjectEntry } from "../registry";
import { statusData } from "../runner";
import { listTasks, type Task } from "../tasks";

export type AgentDetail = Agent & { memory: string; logLines: { agent: string; line: string }[] };

export function loadAgentDetail(c: Crew, name: string): AgentDetail {
  const a = getAgent(c, name);
  const memoryPath = join(a.dir, "memory.md");
  const memory = (() => {
    try {
      return readFileSync(memoryPath, "utf8");
    } catch {
      return "";
    }
  })();
  const lo = new Out();
  logs(c, parseArgs(["logs", name, "--since", "1d"]), lo);
  return { ...a, memory, logLines: (lo.json as { agent: string; line: string }[]) ?? [] };
}

export type Snapshot = {
  status: ReturnType<typeof statusData>;
  tasks: Task[];
  questions: Question[];
  events: CrewEvent[];
  logLines: { agent: string; line: string }[];
  protectedZones: string[];
  at: number;
};

export function loadSnapshot(c: Crew): Snapshot {
  const lo = new Out();
  logs(c, parseArgs(["logs", "--all", "--since", "1d"]), lo);
  return {
    status: statusData(c),
    tasks: listTasks(c),
    questions: listQuestions(c),
    events: readEvents(c, Date.now() - 24 * 36e5).slice(-120),
    logLines: (lo.json as { agent: string; line: string }[]) ?? [],
    protectedZones: c.config().protected ?? [],
    at: Date.now(),
  };
}

export async function act(c: Crew, argv: string[]): Promise<{ ok: boolean; text: string }> {
  const o = await run(c, argv);
  return { ok: o.code === 0, text: o.lines.join("\n") || "(no output)" };
}

// All-projects overview: one snapshot per registered active project, same readers
// as the single-project view. A broken vault shows as an error row, never a crash --
// the point of the overview is seeing everything at a glance.
export type ProjectOverview = {
  entry: ProjectEntry;
  crew: Crew;
  snap: Snapshot | null;
  error: string | null;
};

export function loadProjects(): ProjectOverview[] {
  return listProjects()
    .filter((p) => p.status === "active")
    .map((entry) => {
      const crew = new Crew(entry.path);
      try {
        return { entry, crew, snap: loadSnapshot(crew), error: null };
      } catch (e) {
        return { entry, crew, snap: null, error: e instanceof Error ? e.message : String(e) };
      }
    });
}

// A merged snapshot so the overview reuses the same TopBar: every count is the sum
// across projects, live if any project's server is up.
export function mergeSnapshots(items: ProjectOverview[]): Snapshot {
  const snaps = items.flatMap((p) => (p.snap ? [p.snap] : []));
  const counts: Record<string, number> = {};
  for (const s of snaps) for (const [k, v] of Object.entries(s.status.tasks)) counts[k] = (counts[k] ?? 0) + v;
  const live = snaps.map((s) => s.status.server).find((s) => s.running);
  return {
    status: {
      server: live ?? { running: false as boolean, mode: "machine" as const },
      paused: false,
      agents: snaps.flatMap((s) => s.status.agents),
      tasks: counts,
      review: snaps.reduce((n, s) => n + s.status.review, 0),
      questions: snaps.reduce((n, s) => n + s.status.questions, 0),
      jobs: snaps.reduce((n, s) => n + s.status.jobs, 0),
      locks: {},
      spend: snaps.reduce((n, s) => n + s.status.spend, 0),
    },
    tasks: snaps.flatMap((s) => s.tasks),
    questions: snaps.flatMap((s) => s.questions),
    events: snaps.flatMap((s) => s.events),
    logLines: snaps.flatMap((s) => s.logLines),
    protectedZones: [],
    at: Date.now(),
  };
}

export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

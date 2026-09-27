// Core utilities: vault resolution, config, markdown frontmatter, state, events, args.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import YAML from "yaml";

export class CrewError extends Error {}

// ---------- args ----------
export type Args = { _: string[]; f: Record<string, string[]> };
const BOOL_FLAGS = new Set(["all", "json", "help", "force", "wait"]);

export function parseArgs(argv: string[]): Args {
  const a: Args = { _: [], f: {} };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "--") {
      (a.f["--"] ??= []).push(...argv.slice(i + 1));
      break;
    }
    if (t.startsWith("--") && t.length > 2) {
      const eq = t.indexOf("=");
      let k: string;
      let v: string;
      if (eq > 0) {
        k = t.slice(2, eq);
        v = t.slice(eq + 1);
      } else {
        k = t.slice(2);
        const n = argv[i + 1];
        if (BOOL_FLAGS.has(k) || n === undefined || n.startsWith("--")) v = "true";
        else {
          v = n;
          i++;
        }
      }
      (a.f[k] ??= []).push(v);
    } else a._.push(t);
  }
  return a;
}
export const flag = (a: Args, k: string): string | undefined => a.f[k]?.at(-1);
export const flags = (a: Args, k: string): string[] => a.f[k] ?? [];
export const has = (a: Args, k: string): boolean => a.f[k] !== undefined;
export const list = (s?: string | null): string[] =>
  s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];

// ---------- config ----------
export type RunnerConfig = { cmd: string; args: string[]; cost_from_json?: boolean };
export type CrewConfig = {
  vault_name?: string;
  api?: { port?: number; token?: string };
  runners?: Record<string, RunnerConfig>;
  limits?: { max_sessions?: number; max_jobs?: number; claim_minutes?: number; default_job_timeout?: string };
  budget?: { crew_daily_usd?: number };
  locks?: string[];
  external?: Record<string, string>;
  project?: { repo?: string | null; worktrees?: string | null };
  protected?: string[];
  verify?: {
    sample_rate?: number;
    earn_after?: number;
    earn_agreement?: number;
    tiers?: Record<string, string>;
  };
  anomalies?: { enabled?: boolean; repeat_threshold?: number };
};

export class Crew {
  readonly dir: string;
  constructor(readonly vault: string) {
    this.dir = join(vault, "crew");
  }
  p(...parts: string[]): string {
    return join(this.dir, ...parts);
  }
  config(): CrewConfig {
    return readMd(this.p("crew.md")).data as CrewConfig;
  }
  expand(s: string): string {
    const ext = this.config().external ?? {};
    return s.replace(/\$\{(\w+)\}/g, (_, k: string) => ext[k] ?? process.env[k] ?? `\${${k}}`);
  }
  worktreeBase(): string {
    const w = this.config().project?.worktrees;
    return w ? resolve(this.expand(w)) : resolve(this.vault, "..", `${basename(this.vault)}-crew-worktrees`);
  }
}

export function findVault(explicit?: string): Crew {
  const c = explicit ?? process.env.CREW_VAULT;
  if (c) {
    const v = resolve(c);
    if (!existsSync(join(v, "crew", "crew.md")))
      throw new CrewError(`No crew/crew.md in ${v}. Run "crew init ${v}" first.`);
    return new Crew(v);
  }
  let d = process.cwd();
  for (;;) {
    if (existsSync(join(d, "crew", "crew.md"))) return new Crew(d);
    const p = dirname(d);
    if (p === d) break;
    d = p;
  }
  throw new CrewError("Couldn't find a vault with crew/crew.md. Pass --vault <path> or set CREW_VAULT.");
}

// ---------- markdown with frontmatter ----------
export type Md = { data: Record<string, any>; body: string };

export function parseMd(raw: string): Md {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  return { data: (YAML.parse(m[1]!) ?? {}) as Record<string, any>, body: m[2] ?? "" };
}
export function readMd(path: string): Md {
  return parseMd(readFileSync(path, "utf8"));
}
export function writeMd(path: string, md: Md): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = md.body.startsWith("\n") ? md.body : `\n${md.body}`;
  writeFileSync(path, `---\n${YAML.stringify(md.data).trimEnd()}\n---\n${body}`);
}

// ---------- json state ----------
export function readJson<T>(path: string, dflt: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return dflt;
  }
}
export function writeJson(path: string, v: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 2));
}

// Cross-process mutex around a lock directory. mkdirSync is atomic, so this works as a lock
// primitive with no extra dependency. Shared by withMutex (per-project) and the machine registry
// lock (per-machine) -- same algorithm, different lock path.
export async function withFileLock<T>(lock: string, fn: () => T | Promise<T>): Promise<T> {
  mkdirSync(dirname(lock), { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10_000) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        /* lock vanished, retry */
      }
      if (Date.now() - start > 15_000) throw new CrewError("Timed out waiting for the lock.");
      await Bun.sleep(25);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// Cross-process mutex around shared-state writes. Never nest.
export function withMutex<T>(c: Crew, fn: () => T | Promise<T>): Promise<T> {
  return withFileLock(c.p(".state", ".mutex"), fn);
}

export function nextId(c: Crew, kind: "T" | "J"): string {
  const p = c.p(".state", "seq.json");
  const s = readJson<Record<string, number>>(p, {});
  let n = (s[kind] ?? 0) + 1;
  const fmt = (x: number) => `${kind}-${String(x).padStart(4, "0")}`;
  const taken = (x: number) =>
    kind === "T" ? existsSync(c.p("tasks", `${fmt(x)}.md`)) : existsSync(c.p("jobs", fmt(x)));
  while (taken(n)) n++;
  s[kind] = n;
  writeJson(p, s);
  return fmt(n);
}

// ---------- events ----------
export type CrewEvent = {
  id: string;
  ts: string;
  type: string;
  by: string;
  task?: string;
  agent?: string;
  data?: Record<string, unknown>;
};

export function emit(c: Crew, e: Omit<CrewEvent, "id" | "ts">): CrewEvent {
  const ev: CrewEvent = { id: crypto.randomUUID().slice(0, 8), ts: new Date().toISOString(), ...e };
  const f = c.p("events", `${ev.ts.slice(0, 10)}.jsonl`);
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, `${JSON.stringify(ev)}\n`);
  return ev;
}

export function eventFiles(c: Crew): string[] {
  const d = c.p("events");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => join(d, f));
}

export function parseEvents(text: string): CrewEvent[] {
  const out: CrewEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CrewEvent);
    } catch {
      /* skip partial line */
    }
  }
  return out;
}

export function readEvents(c: Crew, sinceMs = 0): CrewEvent[] {
  const sinceDay = sinceMs ? new Date(sinceMs).toISOString().slice(0, 10) : "";
  const out: CrewEvent[] = [];
  for (const f of eventFiles(c)) {
    if (sinceDay && basename(f, ".jsonl") < sinceDay) continue;
    for (const e of parseEvents(readFileSync(f, "utf8"))) if (Date.parse(e.ts) >= sinceMs) out.push(e);
  }
  return out;
}

// ---------- misc ----------
export function parseDuration(s: string | undefined, dflt: number): number {
  if (!s) return dflt;
  const m = s.match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/);
  if (!m) throw new CrewError(`Bad duration "${s}". Use forms like 30s, 15m, 2h, 1d.`);
  const mult = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as "s" | "m" | "h" | "d"];
  return Number(m[1]) * mult;
}

export function actorOf(a: Args): string {
  return flag(a, "as") ?? process.env.CREW_AGENT ?? "human";
}

export const today = (): string => new Date().toISOString().slice(0, 10);
export const hhmm = (d = new Date()): string => d.toTimeString().slice(0, 5);
export const stamp = (d = new Date()): string => `${d.toISOString().slice(0, 10)} ${hhmm(d)}`;

export function randomToken(bytes = 16): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function pidAlive(pid: number | undefined | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function tail(text: string, n: number): string {
  return text.split("\n").slice(-n).join("\n");
}

// Append a line to an agent's (or the human's) daily log.
export function agentLog(c: Crew, agent: string, text: string, task?: string | null): void {
  const f = c.p("agents", agent, "logs", `${today()}.md`);
  mkdirSync(dirname(f), { recursive: true });
  if (!existsSync(f)) writeFileSync(f, `# ${agent} log ${today()}\n\n`);
  appendFileSync(f, `- ${hhmm()} ${task ? `[[${task}]] ` : ""}${text.replace(/\n/g, " ")}\n`);
}

// Output collector so commands behave the same from the CLI and the HTTP API.
export class Out {
  lines: string[] = [];
  json: unknown = undefined;
  code = 0;
  say(s = ""): void {
    this.lines.push(s);
  }
  fail(s: string): void {
    this.lines.push(s);
    this.code = 1;
  }
}

export { basename, dirname, join, resolve };

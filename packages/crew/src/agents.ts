// Agents: scaffold from templates, lint, enable/disable, list.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  type Args,
  type Crew,
  CrewError,
  type Out,
  actorOf,
  emit,
  flag,
  join,
  list,
  parseMd,
} from "./core";

export type AgentDef = {
  name: string;
  enabled?: boolean;
  runner: string;
  model?: string;
  role?: string;
  can?: string[];
  schedule?: string | null;
  subscribes?: string[];
  jobs?: { languages?: string[]; max_concurrent?: number; default_timeout?: string; locks?: string[] };
  decider?: string;
  budget?: { daily_usd?: number };
  paths?: { external?: string[] };
  wiki?: string[];
};

export type Agent = { name: string; def: AgentDef; raw: string; dir: string };

export function listAgents(c: Crew): Agent[] {
  const d = c.p("agents");
  if (!existsSync(d)) return [];
  const out: Agent[] = [];
  for (const name of readdirSync(d).sort()) {
    const f = join(d, name, "agent.md");
    if (!existsSync(f)) continue;
    const raw = readFileSync(f, "utf8");
    try {
      out.push({ name, def: { ...(parseMd(raw).data as AgentDef), name }, raw, dir: join(d, name) });
    } catch {
      out.push({ name, def: { name, runner: "none", enabled: false }, raw, dir: join(d, name) });
    }
  }
  return out;
}

export function getAgent(c: Crew, name: string): Agent {
  const a = listAgents(c).find((x) => x.name === name);
  if (!a) throw new CrewError(`No agent named ${name}. Run "crew agents" to list them.`);
  return a;
}

export function agentsCmd(c: Crew, o: Out): void {
  const as = listAgents(c);
  o.json = as.map((a) => a.def);
  if (!as.length) return o.say('No agents yet. Create one with "crew agent new <name>".');
  for (const a of as)
    o.say(
      `${a.name.padEnd(14)} ${a.def.enabled ? "enabled " : "disabled"}  ${a.def.runner}/${a.def.model ?? "-"}  can: ${(a.def.can ?? []).join(",")}`,
    );
}

export function agentNew(c: Crew, a: Args, o: Out): void {
  const name = a._[2];
  if (!name) throw new CrewError("Usage: crew agent new <name> --template <name> --runner <name> --model <name> --can a,b");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    throw new CrewError(`Bad agent name "${name}": must start with a lowercase letter or digit, and contain only lowercase letters, digits and dashes -- no capitals, spaces or underscores.`);
  if (name === "human") throw new CrewError('"human" is reserved.');
  const dir = c.p("agents", name);
  if (existsSync(join(dir, "agent.md"))) throw new CrewError(`Agent ${name} already exists.`);
  const tpl = flag(a, "template") ?? "worker";
  const tplPath = c.p("templates", "agents", `${tpl}.md`);
  if (!existsSync(tplPath)) {
    const have = existsSync(c.p("templates", "agents"))
      ? readdirSync(c.p("templates", "agents")).map((f) => f.replace(/\.md$/, "")).join(", ")
      : "none";
    throw new CrewError(`No template "${tpl}". Available: ${have}.`);
  }
  const caps = list(flag(a, "can"));
  const text = readFileSync(tplPath, "utf8")
    .replaceAll("{{NAME}}", name)
    .replaceAll("{{RUNNER}}", flag(a, "runner") ?? "claude")
    .replaceAll("{{MODEL}}", flag(a, "model") ?? "sonnet")
    .replaceAll("{{CAPS}}", caps.join(", "));
  mkdirSync(join(dir, "skills", "scripts"), { recursive: true });
  mkdirSync(join(dir, "logs"), { recursive: true });
  writeFileSync(join(dir, "agent.md"), text);
  if (!existsSync(join(dir, "memory.md")))
    writeFileSync(join(dir, "memory.md"), `# ${name} memory\n\nLasting lessons, one line each, newest last.\n\n`);
  const blanks = (text.match(/\{\{BLANK:/g) ?? []).length;
  emit(c, { type: "agent.scaffolded", by: actorOf(a), agent: name, data: { template: tpl } });
  o.json = { name, path: join(dir, "agent.md"), blanks };
  o.say(`Created ${join(dir, "agent.md")} from "${tpl}" with ${blanks} blanks to fill.`);
  o.say(`Next: fill every {{BLANK: ...}}, then run: crew agent lint ${name} && crew agent enable ${name}`);
}

export type LintResult = { errors: string[]; warnings: string[] };

export function lintAgent(c: Crew, name: string): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const f = c.p("agents", name, "agent.md");
  if (!existsSync(f)) return { errors: [`No agent.md for ${name}.`], warnings };
  const raw = readFileSync(f, "utf8");
  const blanks = raw.match(/\{\{BLANK:[\s\S]*?\}\}/g) ?? [];
  for (const b of blanks) errors.push(`Unfilled ${b}`);
  let def: AgentDef;
  try {
    def = parseMd(raw).data as AgentDef;
  } catch (e) {
    return { errors: [...errors, `Frontmatter isn't valid YAML: ${(e as Error).message}`], warnings };
  }
  const cfg = c.config();
  if (def.name !== name) errors.push(`name is "${def.name}" but the folder is "${name}".`);
  if (!def.role) errors.push("role is empty.");
  if (!def.runner) errors.push("runner is missing.");
  else if (def.runner !== "none") {
    const r = cfg.runners?.[def.runner];
    if (!r) errors.push(`runner "${def.runner}" isn't defined in crew.md runners.`);
    else if (!Bun.which(r.cmd)) warnings.push(`runner command "${r.cmd}" isn't on PATH on this machine.`);
  }
  if (!def.can?.length) warnings.push("can is empty, so this agent won't match any task needs.");
  if (!Array.isArray(def.subscribes)) errors.push("subscribes must be a list.");
  for (const l of def.jobs?.locks ?? [])
    if (!(cfg.locks ?? []).includes(l)) errors.push(`lock "${l}" isn't declared in crew.md locks.`);
  for (const w of def.wiki ?? [])
    if (!existsSync(c.p("wiki", `${w}.md`))) warnings.push(`wiki page "${w}" doesn't exist yet (crew/wiki/${w}.md).`);
  if (def.schedule && def.schedule.split(/\s+/).length !== 5) errors.push("schedule must be a 5-field cron expression.");
  return { errors, warnings };
}

export function agentLint(c: Crew, a: Args, o: Out): void {
  const name = a._[2];
  if (!name) throw new CrewError("Usage: crew agent lint <name>");
  const r = lintAgent(c, name);
  o.json = r;
  for (const e of r.errors) o.say(`error: ${e}`);
  for (const w of r.warnings) o.say(`warning: ${w}`);
  if (r.errors.length) o.code = 1;
  else o.say(`${name} passes lint${r.warnings.length ? " with warnings" : ""}.`);
}

function setEnabled(c: Crew, name: string, on: boolean): void {
  const f = c.p("agents", name, "agent.md");
  const raw = readFileSync(f, "utf8");
  const next = /^enabled:\s*(true|false)\s*$/m.test(raw)
    ? raw.replace(/^enabled:\s*(true|false)\s*$/m, `enabled: ${on}`)
    : raw.replace(/^---\n/, `---\nenabled: ${on}\n`);
  writeFileSync(f, next);
}

export function agentEnable(c: Crew, a: Args, o: Out, on: boolean): void {
  const name = a._[2];
  if (!name) throw new CrewError(`Usage: crew agent ${on ? "enable" : "disable"} <name>`);
  if (on) {
    const r = lintAgent(c, name);
    if (r.errors.length) {
      for (const e of r.errors) o.say(`error: ${e}`);
      o.code = 1;
      return o.say(`${name} stays disabled until lint passes.`);
    }
  } else getAgent(c, name);
  setEnabled(c, name, on);
  emit(c, { type: on ? "agent.enabled" : "agent.disabled", by: actorOf(a), agent: name });
  o.say(`${name} ${on ? "enabled" : "disabled"}.`);
}

export function agentRemove(c: Crew, a: Args, o: Out): void {
  const name = a._[2];
  if (!name) throw new CrewError("Usage: crew agent remove <name>");
  const ag = getAgent(c, name);
  if (ag.def.enabled) throw new CrewError(`${name} is enabled. Run "crew agent disable ${name}" first, then remove it.`);
  rmSync(ag.dir, { recursive: true, force: true });
  emit(c, { type: "agent.removed", by: actorOf(a), agent: name });
  o.say(`Removed ${name}. Tasks previously claimed by it are untouched -- reassign or reclaim them separately.`);
}

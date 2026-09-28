// Agent packs: install a zip of agent definitions into this project's crew/.
// Project-scoped only -- there is no global install. The CLI resolves the project by
// walking up from the current directory (ignoring --vault/--project/CREW_VAULT); the
// HTTP API path reuses the already-resolved project, which is scoped by construction.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { lintAgent, setEnabled } from "./agents";
import {
  type Args,
  Crew,
  CrewError,
  Out,
  actorOf,
  agentLog,
  basename,
  dirname,
  emit,
  flag,
  join,
  parseMd,
  resolve,
  withMutex,
} from "./core";

export type PackManifest = {
  name?: string;
  version?: string;
  agents?: { name: string; enabled?: boolean }[];
};

const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// Zip-slip guard: every file we copy must stay inside the pack root.
function packRoot(tmp: string): string {
  if (existsSync(join(tmp, "agents"))) return tmp;
  const subs = readdirSync(tmp).filter((f) => !f.startsWith(".") && statSync(join(tmp, f)).isDirectory());
  if (subs.length === 1 && existsSync(join(tmp, subs[0]!, "agents"))) return join(tmp, subs[0]!);
  throw new CrewError('Bad pack: expected agents/ at the top level of the zip (e.g. agents/imager/agent.md).');
}

function readManifest(root: string): PackManifest {
  const f = join(root, "pack.json");
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8")) as PackManifest;
  } catch (e) {
    throw new CrewError(`Bad pack.json: ${(e as Error).message}`);
  }
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    if (f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

export function installPack(c: Crew, a: Args, o: Out): void {
  const zip = a._[1];
  if (!zip) throw new CrewError("Usage: crew install <pack.zip> [--force]");
  const zipPath = resolve(zip);
  if (!existsSync(zipPath)) throw new CrewError(`No pack at ${zip}.`);
  const force = flag(a, "force") === "true";
  if (!Bun.which("unzip")) throw new CrewError("crew install needs the unzip command on PATH.");
  const tmp = mkdtempSync(join(tmpdir(), "crew-pack-"));
  try {
    const r = spawnSync("unzip", ["-q", zipPath, "-d", tmp], { encoding: "utf8" });
    if (r.status !== 0) throw new CrewError(`Couldn't unzip ${zip}: ${(r.stderr || r.stdout || "unknown error").trim()}`);
    const root = packRoot(tmp);
    const manifest = readManifest(root);
    const packName = manifest.name ?? basename(zipPath).replace(/\.zip$/i, "");

    const agentsDir = join(root, "agents");
    if (!existsSync(agentsDir)) throw new CrewError("Bad pack: no agents/ folder.");
    const names = readdirSync(agentsDir).filter((f) => !f.startsWith(".") && statSync(join(agentsDir, f)).isDirectory());
    if (!names.length) throw new CrewError("Bad pack: agents/ is empty.");
    for (const n of names) {
      if (n === "human") throw new CrewError('Bad pack: "human" is reserved.');
      if (!AGENT_NAME_RE.test(n)) throw new CrewError(`Bad pack: bad agent name "${n}".`);
      const f = join(agentsDir, n, "agent.md");
      if (!existsSync(f)) throw new CrewError(`Bad pack: agents/${n}/ has no agent.md.`);
      const def = parseMd(readFileSync(f, "utf8")).data as { name?: string };
      if (def.name !== n) throw new CrewError(`Bad pack: agents/${n}/agent.md names "${def.name ?? "(missing)"}", not "${n}".`);
    }

    // Wiki pages first, so lint's wiki warnings reflect the post-install state.
    const wikiDir = join(root, "wiki");
    if (existsSync(wikiDir)) {
      for (const f of walkFiles(wikiDir)) {
        const rel = f.slice(wikiDir.length + 1);
        const dest = c.p("wiki", rel);
        if (existsSync(dest) && !force) continue;
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(f, dest);
        o.say(`wiki/${rel} added.`);
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const who = actorOf(a);
    const installed: string[] = [];
    const skipped: string[] = [];
    const leftDisabled: string[] = [];
    for (const n of names.sort()) {
      const dest = c.p("agents", n);
      if (existsSync(join(dest, "agent.md")) && !force) {
        skipped.push(n);
        o.say(`Skipped ${n}: already installed. Use --force to overwrite it.`);
        continue;
      }
      if (existsSync(dest)) {
        const backup = c.p(".state", "pack-backups", `${packName}-${stamp}`, n);
        mkdirSync(dirname(backup), { recursive: true });
        rmSync(backup, { recursive: true, force: true });
        cpSync(dest, backup, { recursive: true });
        o.say(`${n}: previous version backed up.`);
        rmSync(dest, { recursive: true, force: true });
      }
      cpSync(join(agentsDir, n), dest, { recursive: true });
      mkdirSync(join(dest, "logs"), { recursive: true });
      if (!existsSync(join(dest, "memory.md")))
        writeFileSync(join(dest, "memory.md"), `# ${n} memory\n\nLasting lessons, one line each, newest last.\n\n`);
      const r = lintAgent(c, n);
      for (const e of r.errors) o.say(`error: ${n}: ${e}`);
      for (const w of r.warnings) o.say(`warning: ${n}: ${w}`);
      const wantEnabled = manifest.agents?.find((x) => x.name === n)?.enabled
        ?? (parseMd(readFileSync(join(dest, "agent.md"), "utf8")).data as { enabled?: boolean }).enabled
        ?? false;
      if (r.errors.length) {
        setEnabled(c, n, false);
        leftDisabled.push(n);
        o.say(`${n} stays disabled until lint passes. Run: crew agent lint ${n}`);
      } else {
        setEnabled(c, n, wantEnabled);
        o.say(`${n} installed${wantEnabled ? " and enabled" : " (disabled)"}.`);
      }
      emit(c, { type: "agent.installed", by: who, agent: n, data: { pack: packName, version: manifest.version ?? null } });
      agentLog(c, n, `installed from pack ${packName}`);
      installed.push(n);
    }
    o.json = { pack: packName, version: manifest.version ?? null, installed, skipped, leftDisabled };
    if (installed.length) o.say(`Next: crew agents`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// CLI entry: resolves the project from the current directory only. Env vars and
// --vault/--project are deliberately ignored -- packs install where you stand.
export async function installCmd(a: Args): Promise<Out> {
  const o = new Out();
  try {
    if (flag(a, "vault") || flag(a, "project"))
      throw new CrewError("crew install works on the project in the current directory. cd into it and run crew install <pack.zip> without --vault/--project.");
    let d = process.cwd();
    let vault: string | null = null;
    for (;;) {
      if (existsSync(join(d, "crew", "crew.md"))) {
        vault = d;
        break;
      }
      const p = dirname(d);
      if (p === d) break;
      d = p;
    }
    if (!vault)
      throw new CrewError("No crew/ found here. Agent packs can only be installed into a project, not globally at this time. cd into a project or run crew init first.");
    await withMutex(new Crew(vault), async () => installPack(new Crew(vault!), a, o));
  } catch (e) {
    if (e instanceof CrewError) o.fail(`error: ${e.message}`);
    else throw e;
  }
  return o;
}

// Project lifecycle commands (crew projects / project add|pause|resume|remove) and machine
// service install/uninstall/status -- all machine-scoped, not project-scoped, so they operate on
// the registry directly rather than through a single Crew (see machine-commands.ts's runMachine).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { platform } from "node:process";
import { type Args, Crew, CrewError, type Out, basename, flag, join, resolve } from "./core";
import { spendToday } from "./comms";
import { SELF_ARGS } from "./jobs";
import { ensureMachineHome, machineHome } from "./machine";
import { detectKind, liveV0ServerPid, listProjects, readRegistry, registerProject, slugify, withRegistryLock, writeRegistry } from "./registry";
import { activeSessions } from "./runner";

export function projectsCmd(o: Out): void {
  const home = machineHome();
  const rows = listProjects(home).map((p) => {
    const missing = !existsSync(p.path);
    if (missing) return { ...p, missing, agentsRunning: 0, spendToday: 0 };
    const c = new Crew(p.path);
    const spend = Object.values(spendToday(c)).reduce((x, y) => x + y, 0);
    return { ...p, missing, agentsRunning: activeSessions(c).length, spendToday: spend };
  });
  o.json = rows;
  if (!rows.length) return o.say('No projects registered yet. Run "crew init <path>" or "crew project add <path>".');
  for (const p of rows)
    o.say(
      `${p.id.padEnd(14)} ${(p.missing ? "missing" : p.status).padEnd(8)} ${p.kind.padEnd(6)} agents:${p.agentsRunning} $${p.spendToday.toFixed(2)}  ${p.path}`,
    );
}

export async function projectAdd(a: Args, o: Out): Promise<void> {
  const path = a._[2];
  if (!path) throw new CrewError("Usage: crew project add <path> [--id id]");
  const target = resolve(path);
  if (!existsSync(join(target, "crew", "crew.md")))
    throw new CrewError(`No crew/crew.md in ${target}. Run "crew init ${target}" to create one, or check the path.`);
  const live = liveV0ServerPid(target);
  if (live) throw new CrewError(`${target} has a v0 crew server running right now (pid ${live}). Stop it first -- registering a running vault would double-dispatch it.`);
  const id = flag(a, "id") ?? slugify(basename(target));
  const kind = detectKind(target);
  ensureMachineHome();
  await registerProject({ id, path: target, kind, status: "active" });
  o.say(`Registered "${id}" (${kind}) at ${target}.`);
}

async function setStatus(id: string, status: "active" | "paused", o: Out): Promise<void> {
  await withRegistryLock(() => {
    const r = readRegistry();
    const p = r.projects[id];
    if (!p) throw new CrewError(`No registered project "${id}". Run "crew projects" to list them.`);
    p.status = status;
    writeRegistry(r);
  });
  o.say(`${id} ${status === "active" ? "resumed" : "paused"}.`);
}

export const projectPause = (id: string, o: Out): Promise<void> => setStatus(id, "paused", o);
export const projectResume = (id: string, o: Out): Promise<void> => setStatus(id, "active", o);

export async function projectRemove(id: string, o: Out): Promise<void> {
  await withRegistryLock(() => {
    const r = readRegistry();
    if (!r.projects[id]) throw new CrewError(`No registered project "${id}".`);
    delete r.projects[id];
    writeRegistry(r);
  });
  o.say(`Unregistered ${id}. Its files are untouched -- "crew project add" at the same path to bring it back.`);
}

// ---------- crew service install|uninstall|status ----------
// Same launchd/systemd approach as scripts/service.sh, but for the machine service (crew serve,
// no --vault) under a distinct label so it never touches an existing per-vault install.

const LABEL = "com.crew.machine";
const UNIT = "crew-machine";

function programArgs(): string[] {
  return [process.execPath, ...SELF_ARGS, "serve"];
}

export function serviceCtl(action: string, o: Out): void {
  const home = machineHome();
  ensureMachineHome(home);
  const log = join(home, "logs", "service.log");
  const [bin, ...args] = programArgs();

  if (platform === "darwin") {
    const plist = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
    if (action === "install") {
      const argXml = [bin!, ...args].map((x) => `<string>${x}</string>`).join("");
      mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
      writeFileSync(
        plist,
        `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>${LABEL}</string>\n  <key>ProgramArguments</key><array>${argXml}</array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>StandardOutPath</key><string>${log}</string>\n  <key>StandardErrorPath</key><string>${log}</string>\n  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${process.env.PATH ?? ""}</string></dict>\n</dict></plist>\n`,
      );
      try {
        execSync(`launchctl unload "${plist}"`, { stdio: "ignore" });
      } catch {
        /* wasn't loaded */
      }
      execSync(`launchctl load "${plist}"`);
      o.say(`Installed and started ${plist}`);
    } else if (action === "uninstall") {
      try {
        execSync(`launchctl unload "${plist}"`, { stdio: "ignore" });
      } catch {
        /* wasn't loaded */
      }
      rmSync(plist, { force: true });
      o.say(`Removed ${plist}`);
    } else if (action === "status") {
      try {
        o.say(execSync(`launchctl list | grep ${LABEL}`).toString().trim());
      } catch {
        o.say("not loaded");
      }
    } else throw new CrewError(`Unknown action "${action}". Use install, uninstall or status.`);
  } else {
    const unit = join(homedir(), ".config", "systemd", "user", `${UNIT}.service`);
    if (action === "install") {
      mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true });
      writeFileSync(
        unit,
        `[Unit]\nDescription=crew machine service\n\n[Service]\nExecStart=${[bin, ...args].join(" ")}\nRestart=on-failure\nEnvironment=PATH=${process.env.PATH ?? ""}\nStandardOutput=append:${log}\nStandardError=append:${log}\n\n[Install]\nWantedBy=default.target\n`,
      );
      execSync("systemctl --user daemon-reload");
      execSync(`systemctl --user enable --now ${UNIT}.service`);
      o.say(`Installed and started ${unit}`);
    } else if (action === "uninstall") {
      try {
        execSync(`systemctl --user disable --now ${UNIT}.service`, { stdio: "ignore" });
      } catch {
        /* wasn't enabled */
      }
      rmSync(unit, { force: true });
      execSync("systemctl --user daemon-reload");
      o.say(`Removed ${unit}`);
    } else if (action === "status") {
      try {
        o.say(execSync(`systemctl --user status ${UNIT}.service --no-pager`).toString().trim());
      } catch (e) {
        o.say((e as { stdout?: Buffer }).stdout?.toString().trim() ?? "not running");
      }
    } else throw new CrewError(`Unknown action "${action}". Use install, uninstall or status.`);
  }
}

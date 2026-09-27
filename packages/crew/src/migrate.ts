// crew migrate <path>: brings an existing v0 vault (one that's been running its own
// `crew serve --vault <path>`) into the machine registry. Stops its own server if one is running,
// removes any scripts/service.sh launchd/systemd unit for it, registers it, and splits its
// crew.md settings (api.port is now machine-owned; the vault's token stays as this project's own
// project-tier token). Safe to re-run -- every step is a no-op once already done.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { platform } from "node:process";
import { type Args, CrewError, Out, basename, flag, join, pidAlive, resolve } from "./core";
import { detectKind, findProjectByPath, liveV0ServerPid, registerProject, slugify } from "./registry";

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "-");
}

// Mirrors scripts/service.sh's own naming exactly, so this finds units that script installed.
function serviceUnitName(vaultPath: string): string {
  return `crew-${sanitize(basename(vaultPath))}`;
}

async function stopLiveServer(vaultPath: string, o: Out): Promise<void> {
  const pid = liveV0ServerPid(vaultPath);
  if (!pid) return;
  process.kill(pid, "SIGTERM");
  const stateFile = join(vaultPath, "crew", ".state", "server.json");
  for (let i = 0; i < 40; i++) {
    if (!existsSync(stateFile)) {
      o.say(`Stopped the running crew server (pid ${pid}).`);
      return;
    }
    await Bun.sleep(250);
  }
  if (pidAlive(pid))
    throw new CrewError(`Couldn't stop the running crew server (pid ${pid}) for ${vaultPath}. Stop it manually, then run migrate again.`);
}

function removeServiceUnit(vaultPath: string, o: Out): void {
  const name = serviceUnitName(vaultPath);
  if (platform === "darwin") {
    const plist = join(homedir(), "Library", "LaunchAgents", `com.crew.${name}.plist`);
    if (!existsSync(plist)) return;
    try {
      execSync(`launchctl unload "${plist}"`, { stdio: "ignore" });
    } catch {
      /* wasn't loaded */
    }
    rmSync(plist, { force: true });
    o.say(`Removed the standalone service install at ${plist}.`);
  } else {
    const unit = join(homedir(), ".config", "systemd", "user", `${name}.service`);
    if (!existsSync(unit)) return;
    try {
      execSync(`systemctl --user disable --now ${name}.service`, { stdio: "ignore" });
    } catch {
      /* wasn't enabled */
    }
    rmSync(unit, { force: true });
    try {
      execSync("systemctl --user daemon-reload");
    } catch {
      /* best effort */
    }
    o.say(`Removed the standalone service install at ${unit}.`);
  }
}

// Targeted line removal, not a full readMd/writeMd round-trip -- protects a human's own
// formatting/comments in crew.md. Only touches the port: line directly under api:.
function stripApiPort(crewMdPath: string, o: Out): void {
  const raw = readFileSync(crewMdPath, "utf8");
  const next = raw.replace(/^(api:\r?\n)(\s+port:\s*\d+\s*\r?\n)/m, "$1");
  if (next !== raw) {
    writeFileSync(crewMdPath, next);
    o.say("Dropped api.port from crew.md (now machine-owned). Its token stays as this project's own token.");
  }
}

export async function migrateCmd(a: Args): Promise<Out> {
  const o = new Out();
  const pathArg = a._[1];
  if (!pathArg) throw new CrewError("Usage: crew migrate <path>");
  const target = resolve(pathArg);
  const crewMd = join(target, "crew", "crew.md");
  if (!existsSync(crewMd)) throw new CrewError(`No crew/crew.md in ${target}. Nothing to migrate -- use "crew init ${target}" for a brand-new project.`);

  await stopLiveServer(target, o);
  removeServiceUnit(target, o);

  const already = findProjectByPath(target);
  const id = already?.id ?? flag(a, "id") ?? slugify(basename(target));
  const kind = detectKind(target);
  await registerProject({ id, path: target, kind, status: "active" });
  o.say(`Registered "${id}" (${kind}) with the machine service.`);

  stripApiPort(crewMd, o);

  o.json = { id, path: target, kind };
  o.say(`${target} is migrated. The machine service will pick it up within a second (no restart needed).`);
  return o;
}

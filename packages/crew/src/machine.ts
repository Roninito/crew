// The machine home: ~/.crew/, shared by every registered project's service (crew serve with no
// --vault). Same file-based approach as a project's own crew/ folder -- crew.md is YAML
// frontmatter read with the same readMd/writeMd used everywhere else, not a new mechanism.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { type RunnerConfig, join, pidAlive, randomToken, readJson, readMd, resolve } from "./core";

export type MachineConfig = {
  api?: { port?: number; token?: string };
  // Reserved for later phases (machine-wide defaults/enforcement); read but not yet acted on.
  runners?: Record<string, RunnerConfig>;
  locks?: string[];
  budget?: { machine_daily_usd?: number };
  limits?: { max_live_sessions?: number };
};

// CREW_HOME lets tests (and anyone who wants a second machine) point at a throwaway home instead
// of the real one -- never touched unless a caller opts in.
export function machineHome(): string {
  return resolve(process.env.CREW_HOME ? process.env.CREW_HOME : join(homedir(), ".crew"));
}

// Safe to re-run: only creates what's missing, never overwrites an existing crew.md/projects.md.
export function ensureMachineHome(home = machineHome()): void {
  mkdirSync(join(home, ".state"), { recursive: true });
  mkdirSync(join(home, "logs"), { recursive: true });
  const cfgPath = join(home, "crew.md");
  if (!existsSync(cfgPath))
    writeFileSync(cfgPath, `---\napi:\n  port: 7717\n  token: "${randomToken()}"\n---\n\n# crew machine settings\n\nShared by every project registered with this machine's crew service.\n`);
  const regPath = join(home, "projects.md");
  if (!existsSync(regPath)) writeFileSync(regPath, "---\nprojects: {}\ngrants: []\n---\n");
}

export function machineConfig(home = machineHome()): MachineConfig {
  ensureMachineHome(home);
  return readMd(join(home, "crew.md")).data as MachineConfig;
}

// Whether *a* machine service is up right now, for any registered project's serverInfo() to check
// against -- read from the same pid.json serveMachine() writes on start and removes on shutdown.
export function machineServiceInfo(home = machineHome()): { pid: number; port: number; started: string } | null {
  const s = readJson<{ pid?: number; port?: number; started?: string }>(join(home, ".state", "pid.json"), {});
  return s.pid && s.port && s.started && pidAlive(s.pid) ? { pid: s.pid, port: s.port, started: s.started } : null;
}

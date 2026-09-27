// The project registry: ~/.crew/projects.md, one entry per folder registered with the machine
// service. A note like everything else in crew -- YAML frontmatter, reads and diffs by hand.
import { existsSync, readFileSync, statSync } from "node:fs";
import { machineHome } from "./machine";
import { CrewError, join, pidAlive, readMd, withFileLock, writeMd } from "./core";

export type ProjectKind = "vault" | "repo" | "folder";
export type ProjectStatus = "active" | "paused";
export type ProjectEntry = { id: string; path: string; kind: ProjectKind; status: ProjectStatus; aliases?: string[] };
export type Registry = { projects: Record<string, Omit<ProjectEntry, "id">>; grants: unknown[] };

export const registryPath = (home = machineHome()): string => join(home, "projects.md");

export function readRegistry(home = machineHome()): Registry {
  const p = registryPath(home);
  if (!existsSync(p)) return { projects: {}, grants: [] };
  const data = readMd(p).data as Partial<Registry>;
  return { projects: data.projects ?? {}, grants: data.grants ?? [] };
}

export function writeRegistry(r: Registry, home = machineHome()): void {
  writeMd(registryPath(home), { data: r, body: "" });
}

export function withRegistryLock<T>(fn: () => T | Promise<T>, home = machineHome()): Promise<T> {
  return withFileLock(join(home, ".state", ".registry-mutex"), fn);
}

export function listProjects(home = machineHome()): ProjectEntry[] {
  const r = readRegistry(home);
  return Object.entries(r.projects)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function findProjectById(id: string, home = machineHome()): ProjectEntry | undefined {
  return listProjects(home).find((p) => p.id === id);
}

export function findProjectByPath(path: string, home = machineHome()): ProjectEntry | undefined {
  return listProjects(home).find((p) => p.path === path);
}

export function isMissing(p: ProjectEntry): boolean {
  return !existsSync(p.path);
}

export function detectKind(path: string): ProjectKind {
  if (existsSync(join(path, ".obsidian"))) return "vault";
  if (existsSync(join(path, ".git"))) return "repo";
  return "folder";
}

// Letters, digits and -, 2 to 24 characters. IDs are permanent (they become part of every
// qualified ID in later phases), so this is deliberately strict.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

export function validateId(id: string): void {
  if (!/^[a-z0-9-]{2,24}$/.test(id))
    throw new CrewError(`Bad project id "${id}": must be 2-24 characters, lowercase letters, digits and dashes only.`);
}

// Registers a project. Throws if the id is already taken by a different path (ids never change
// once issued, so a collision needs an explicit --id, not a silent auto-suffix).
export async function registerProject(entry: ProjectEntry, home = machineHome()): Promise<void> {
  validateId(entry.id);
  await withRegistryLock(() => {
    const r = readRegistry(home);
    const existing = r.projects[entry.id];
    if (existing && existing.path !== entry.path)
      throw new CrewError(`Project id "${entry.id}" is already registered to ${existing.path}. Pick a different --id.`);
    r.projects[entry.id] = { path: entry.path, kind: entry.kind, status: entry.status };
    writeRegistry(r, home);
  }, home);
}

// A live v0 `crew serve --vault <path>` process for this folder, if one is currently running --
// used to refuse registering an already-running vault into the machine service (which would
// otherwise double-dispatch it from two processes at once).
export function liveV0ServerPid(projectPath: string): number | null {
  const f = join(projectPath, "crew", ".state", "server.json");
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, "utf8")) as { pid?: number };
    return s.pid && pidAlive(s.pid) ? s.pid : null;
  } catch {
    return null;
  }
}

export function registryMtimeMs(home = machineHome()): number {
  try {
    return statSync(registryPath(home)).mtimeMs;
  } catch {
    return 0;
  }
}

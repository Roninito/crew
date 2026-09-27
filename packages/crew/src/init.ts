// crew init: scaffolds crew/ in a folder (any folder -- an Obsidian vault, a git repo, or plain)
// and registers it with the machine service. Ports scripts/init-vault.sh's logic into the binary
// itself via the same embed-and-materialize pattern jobs.ts already uses for job helpers, so
// there's one source of truth for "what does a freshly initialized crew folder look like" instead
// of that bash script and Wrangler's own vault-assets.generated.ts independently scaffolding it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  type Args,
  CrewError,
  Out,
  basename,
  dirname,
  flag,
  join,
  randomToken,
  resolve,
} from "./core";
import { ensureMachineHome, machineHome } from "./machine";
import { detectKind, findProjectByPath, liveV0ServerPid, registerProject, slugify, validateId } from "./registry";
import { CREW_MANAGER_SKILL_ASSETS, VAULT_TEMPLATE_ASSETS } from "./vault-template-embedded.generated";

const VAULT_DIRS = [
  "agents",
  "tasks",
  "blackboard",
  "events",
  "jobs",
  "assets",
  "reviews",
  "traces",
  "worktrees",
  "wiki",
  "templates/agents",
  "templates/scripts",
  "skills",
  ".state",
];

// Only writes files that are missing -- safe to re-run, same guarantee scripts/init-vault.sh gives.
function materialize(assets: Record<string, string>, destDir: string, overwrite: boolean): void {
  for (const [rel, content] of Object.entries(assets)) {
    const dest = join(destDir, rel);
    if (!overwrite && existsSync(dest)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
}

export async function initCmd(a: Args): Promise<Out> {
  const o = new Out();
  ensureMachineHome();
  const target = resolve(a._[1] ?? process.cwd());
  mkdirSync(target, { recursive: true });
  const name = basename(target);
  const c = join(target, "crew");
  const alreadyRegistered = findProjectByPath(target);

  const live = liveV0ServerPid(target);
  if (live) throw new CrewError(`${target} already has a v0 crew server running (pid ${live}). Stop it before registering this folder with the machine service.`);

  if (!existsSync(join(c, "crew.md"))) {
    for (const d of VAULT_DIRS) mkdirSync(join(c, d), { recursive: true });
    const assetsDir = resolve(flag(a, "assets") ?? join(dirname(target), `${name}-assets`));
    mkdirSync(assetsDir, { recursive: true });
    materialize(VAULT_TEMPLATE_ASSETS, c, false);
    const cfgPath = join(c, "crew.md");
    const raw = readFileSync(cfgPath, "utf8");
    if (raw.includes("{{TOKEN}}"))
      writeFileSync(
        cfgPath,
        raw
          .replaceAll("{{TOKEN}}", randomToken())
          .replaceAll("{{VAULT_NAME}}", name)
          .replaceAll("{{ASSETS}}", assetsDir),
      );
    if (!existsSync(join(c, ".state", "README.md")))
      writeFileSync(join(c, ".state", "README.md"), "Machine state for crew (locks, sessions, spend). Don't edit by hand.\n");
    o.say(`crew is set up in ${c}`);
    o.say(`External assets folder: ${assetsDir}`);
  } else {
    o.say(`${c} already exists -- scaffolding left as-is.`);
  }
  // Always refreshed from source, unlike the template above (mirrors init-vault.sh's own asymmetry).
  materialize(CREW_MANAGER_SKILL_ASSETS, join(c, "skills", "crew-manager"), true);

  const kind = detectKind(target);
  const id = alreadyRegistered?.id ?? flag(a, "id") ?? slugify(name);
  validateId(id);
  await registerProject({ id, path: target, kind, status: "active" });

  o.json = { id, path: target, kind };
  o.say(`Registered as "${id}" (${kind}) with the machine service at ${machineHome()}.`);
  o.say(`Next: crew --project ${id} status`);
  o.say(`Point your copilot at ${c}/skills/crew-manager/SKILL.md`);
  return o;
}

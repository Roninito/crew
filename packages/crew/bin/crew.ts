#!/usr/bin/env bun
// crew CLI entry point.
import { existsSync } from "node:fs";
import { run, HELP } from "../src/commands";
import { type Args, Crew, CrewError, type Out, dirname, findVault, join, parseArgs, flag } from "../src/core";
import { initCmd } from "../src/init";
import { jobExec } from "../src/jobs";
import { runMachine } from "../src/machine-commands";
import { migrateCmd } from "../src/migrate";
import { installCmd } from "../src/packs";
import { findProjectById, findProjectByPath, listProjects, splitQualified } from "../src/registry";
import { sessionRun } from "../src/runner";
import { serveMachine } from "../src/service";
import { serve } from "../src/server";
import { runTui } from "../src/tui/index";

function print(o: Out, json: boolean): void {
  if (json) console.log(JSON.stringify(o.json ?? { out: o.lines }, null, 2));
  else if (o.lines.length) console.log(o.lines.join("\n"));
}

// A qualified id in the arguments (crew claim art:T-0311) names its project just as explicitly as
// --project does. Scans every positional arg after the command word for the first one that
// splits into a *registered* project id -- requiring registration is what keeps this from ever
// misfiring on an argument that merely happens to contain a colon.
function findQualifiedProjectId(a: Args): string | null {
  for (const arg of a._.slice(1)) {
    const q = splitQualified(arg);
    if (q && findProjectById(q.project)) return q.project;
  }
  return null;
}

// Which project a bare command means, in order: --vault/CREW_VAULT (v0, unchanged, always wins),
// --project/CREW_PROJECT or a qualified id in the arguments (looked up in the registry), the
// nearest crew/crew.md walking up from cwd (a registered one resolves to that project; an
// unregistered one still resolves like v0 does today, so nothing that works now stops working),
// else fail listing what's registered.
function resolveProject(vaultFlag: string | undefined, a: Args, qualifiedProjectId: string | null): Crew {
  if (vaultFlag || process.env.CREW_VAULT) return findVault(vaultFlag);
  const wantId = flag(a, "project") ?? qualifiedProjectId ?? process.env.CREW_PROJECT;
  if (wantId) {
    const p = findProjectById(wantId);
    if (!p) throw new CrewError(`No registered project "${wantId}". Run "crew projects" to list them.`);
    return new Crew(p.path);
  }
  let d = process.cwd();
  for (;;) {
    if (existsSync(join(d, "crew", "crew.md"))) {
      const p = findProjectByPath(d);
      return new Crew(p?.path ?? d);
    }
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  const known = listProjects().map((p) => p.id).join(", ") || "(none)";
  throw new CrewError(`Couldn't find a project. Pass --project <id>, --vault <path>, or cd into one. Registered: ${known}`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const a = parseArgs(argv);
  if (!a._.length || a._[0] === "help" || flag(a, "help")) {
    console.log(HELP);
    return 0;
  }
  const json = flag(a, "json") === "true";
  const [cmd, sub] = a._;

  if (cmd === "init") {
    const o = await initCmd(a);
    print(o, json);
    return o.code;
  }
  if (cmd === "migrate") {
    const o = await migrateCmd(a);
    print(o, json);
    return o.code;
  }
  if (cmd === "projects" || cmd === "project" || cmd === "service") {
    const o = await runMachine(argv);
    print(o, json);
    return o.code;
  }
  if (cmd === "install") {
    const o = await installCmd(a);
    print(o, json);
    return o.code;
  }

  const vaultFlag = flag(a, "vault");
  if (cmd === "serve" && !vaultFlag && !process.env.CREW_VAULT) {
    await serveMachine();
    return -1; // keep running
  }

  // A qualified id only ever means something once --vault/CREW_VAULT is ruled out (that tier
  // always wins outright, same as before qualified ids existed).
  // --project (if given) always wins the resolution priority anyway (see resolveProject) -- also
  // suppressing the qualified-id scan in that case means a qualified arg combined with an
  // explicit --project for a *different* project fails loudly (no local match found) instead of
  // the qualified prefix being silently stripped for the wrong target.
  const qualifiedProjectId = vaultFlag || process.env.CREW_VAULT || flag(a, "project") ? null : findQualifiedProjectId(a);

  // "crew status" with nothing to narrow it to one project (no --project, no --vault, cwd isn't
  // inside a registered/unregistered vault) means "show me everything" -- loop every registered
  // active project instead of erroring, since status is read-only and each project's own Crew
  // already prefixes its agent lines with its project id.
  if (cmd === "status" && !vaultFlag && !process.env.CREW_VAULT && !flag(a, "project") && !qualifiedProjectId) {
    let singleProject: Crew | null = null;
    try {
      singleProject = resolveProject(vaultFlag, a, qualifiedProjectId);
    } catch {
      /* not inside one project's vault; fall through to the all-projects view below */
    }
    if (!singleProject) {
      const projects = listProjects().filter((p) => p.status === "active");
      if (!projects.length) {
        console.log('No registered projects. Run "crew init" or "crew migrate <path>".');
        return 0;
      }
      if (json) {
        const out: Record<string, unknown> = {};
        for (const p of projects) out[p.id] = (await run(new Crew(p.path), ["status"])).json;
        console.log(JSON.stringify(out, null, 2));
      } else {
        for (const p of projects) {
          console.log(`== ${p.id} ==`);
          print(await run(new Crew(p.path), ["status"]), false);
        }
      }
      return 0;
    }
  }

  // Strip --vault/--project from what the router sees (kept from v0), and strip a qualified
  // prefix from the one arg that supplied it, so the target project only ever sees its own local
  // id -- exactly like today, no command needs to know qualified ids exist.
  const clean: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vault" || argv[i] === "--project") { i++; continue; }
    if (argv[i]?.startsWith("--vault=") || argv[i]?.startsWith("--project=")) continue;
    const q = qualifiedProjectId ? splitQualified(argv[i] ?? "") : null;
    clean.push(q && q.project === qualifiedProjectId ? q.local : argv[i]!);
  }
  if (cmd === "tui") {
    // An explicit target (--vault/--project/CREW_VAULT or a qualified id) resolves
    // strictly and still errors loudly when it names nothing. With no target the
    // TUI opens on the all-projects overview instead of refusing to launch --
    // Enter drills into a project, Esc comes back out. Handled before the shared
    // resolveProject below, which would throw for the no-project case.
    const narrowed = vaultFlag || process.env.CREW_VAULT || flag(a, "project") || qualifiedProjectId;
    if (narrowed) {
      await runTui(resolveProject(vaultFlag, a, qualifiedProjectId));
    } else {
      let c: Crew | null = null;
      try {
        c = resolveProject(vaultFlag, a, qualifiedProjectId);
      } catch {
        /* not inside a project; the overview is the launch */
      }
      await runTui(c);
    }
    return 0;
  }
  const c = resolveProject(vaultFlag, a, qualifiedProjectId);
  if (cmd === "serve") {
    await serve(c);
    return -1; // keep running
  }
  if (cmd === "session") {
    await sessionRun(c, sub ?? "", a._[2] ?? "");
    return 0;
  }
  if (cmd === "job" && sub === "exec") {
    await jobExec(c, a._[2] ?? "");
    return 0;
  }
  const o = await run(c, clean);
  print(o, json);
  return o.code;
}

main()
  .then((code) => {
    if (code >= 0) process.exit(code);
  })
  .catch((e) => {
    console.error(e instanceof CrewError ? `error: ${e.message}` : e);
    process.exit(1);
  });

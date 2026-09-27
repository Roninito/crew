#!/usr/bin/env bun
// crew CLI entry point.
import { existsSync } from "node:fs";
import { run, HELP } from "../src/commands";
import { type Args, Crew, CrewError, type Out, dirname, findVault, join, parseArgs, flag } from "../src/core";
import { initCmd } from "../src/init";
import { jobExec } from "../src/jobs";
import { runMachine } from "../src/machine-commands";
import { findProjectById, findProjectByPath, listProjects } from "../src/registry";
import { sessionRun } from "../src/runner";
import { serveMachine } from "../src/service";
import { serve } from "../src/server";

function print(o: Out, json: boolean): void {
  if (json) console.log(JSON.stringify(o.json ?? { out: o.lines }, null, 2));
  else if (o.lines.length) console.log(o.lines.join("\n"));
}

// Which project a bare command means, in order: --vault/CREW_VAULT (v0, unchanged, always wins),
// --project/CREW_PROJECT (looked up in the registry), the nearest crew/crew.md walking up from
// cwd (a registered one resolves to that project; an unregistered one still resolves like v0
// does today, so nothing that works now stops working), else fail listing what's registered.
function resolveProject(vaultFlag: string | undefined, a: Args): Crew {
  if (vaultFlag || process.env.CREW_VAULT) return findVault(vaultFlag);
  const wantId = flag(a, "project") ?? process.env.CREW_PROJECT;
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
  if (cmd === "projects" || cmd === "project" || cmd === "service") {
    const o = await runMachine(argv);
    print(o, json);
    return o.code;
  }

  const vaultFlag = flag(a, "vault");
  if (cmd === "serve" && !vaultFlag && !process.env.CREW_VAULT) {
    await serveMachine();
    return -1; // keep running
  }

  // Strip --vault from what the router sees (kept from v0; --project needs the same treatment).
  const clean: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vault" || argv[i] === "--project") i++;
    else if (argv[i]?.startsWith("--vault=") || argv[i]?.startsWith("--project=")) continue;
    else clean.push(argv[i]!);
  }
  const c = resolveProject(vaultFlag, a);
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

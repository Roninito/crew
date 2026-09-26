#!/usr/bin/env bun
// crew CLI entry point.
import { run, HELP } from "../src/commands";
import { CrewError, findVault, parseArgs, flag } from "../src/core";
import { jobExec } from "../src/jobs";
import { sessionRun } from "../src/runner";
import { serve } from "../src/server";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const a = parseArgs(argv);
  if (!a._.length || a._[0] === "help" || flag(a, "help")) {
    console.log(HELP);
    return 0;
  }
  // Strip --vault from what the router sees.
  const clean: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vault") i++;
    else if (argv[i]?.startsWith("--vault=")) continue;
    else clean.push(argv[i]!);
  }
  const c = findVault(flag(a, "vault"));
  const [cmd, sub] = a._;
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
  if (flag(a, "json") === "true") console.log(JSON.stringify(o.json ?? { out: o.lines }, null, 2));
  else if (o.lines.length) console.log(o.lines.join("\n"));
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

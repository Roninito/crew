// Helpers for Bun job scripts. Import with:
//   import { emit, result, renew, log } from `${process.env.CREW_HELPERS}/bun/crew.ts`;
// or copy this file next to your script. Uses the env that `crew job exec` sets.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

function crew(args: string[]): void {
  const bun = process.env.CREW_BUN ?? "bun";
  const cli = process.env.CREW_CLI;
  const cmd = cli ? [bun, cli, ...args] : ["crew", ...args];
  const r = Bun.spawnSync(cmd, { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) console.error(`[crew] ${args[0]} failed: ${r.stderr.toString().trim()}`);
}

/** Send a custom or progress event, e.g. emit("job.progress", { pct: 40 }). */
export function emit(type: string, data: Record<string, unknown> = {}): void {
  const full = type.includes(".") ? type : `job.${type}`;
  crew(["emit", full, "--data", JSON.stringify({ job: process.env.CREW_JOB_ID, ...data })]);
}

/** Shorthand for emit("job.progress", { pct }). */
export function progress(pct: number, note = ""): void {
  emit("job.progress", { pct, note });
}

/** Write result.json for the job. files: paths produced; anything else is passed to the agent on wake. */
export function result(data: Record<string, unknown>): void {
  const dir = process.env.CREW_JOB_DIR;
  if (!dir) throw new Error("CREW_JOB_DIR not set; run this script through `crew job run`.");
  writeFileSync(join(dir, "result.json"), JSON.stringify(data, null, 2));
}

/** Keep the task claim alive during long jobs. */
export function renew(): void {
  if (process.env.CREW_TASK) crew(["renew", process.env.CREW_TASK]);
}

/** Append a line to the agent's daily log. */
export function log(text: string): void {
  crew(["log", text]);
}

/** Folder for output files; everything here is listed on wake. */
export const outDir = (): string => process.env.CREW_JOB_OUT ?? ".";

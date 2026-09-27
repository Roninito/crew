// Dispatcher for machine-scoped commands (crew projects / project ... / service ...) -- these
// have no single Crew to close over, so they can't go through commands.ts's run(c, argv). Kept in
// the same spirit: one function, the same Out shape, mutating registry changes wrapped in the
// machine lock instead of a project's own mutex.
import { CrewError, Out, parseArgs } from "./core";
import { projectAdd, projectPause, projectRemove, projectResume, projectsCmd, serviceCtl } from "./projects";
import { withRegistryLock } from "./registry";

export async function runMachine(argv: string[]): Promise<Out> {
  const a = parseArgs(argv);
  const o = new Out();
  const [cmd, sub] = a._;
  const key = cmd === "project" ? `project.${sub ?? ""}` : (cmd ?? "");
  const exec = async (): Promise<void> => {
    switch (key) {
      case "projects":
        return projectsCmd(o);
      case "project.add":
        return projectAdd(a, o);
      case "project.pause":
        return projectPause(a._[2] ?? "", o);
      case "project.resume":
        return projectResume(a._[2] ?? "", o);
      case "project.remove":
        return projectRemove(a._[2] ?? "", o);
      case "service":
        return serviceCtl(sub ?? "", o);
      default:
        throw new CrewError(`Unknown command "${argv.join(" ")}". Run crew help.`);
    }
  };
  const MUTATING = new Set(["project.add", "project.pause", "project.resume", "project.remove"]);
  try {
    if (MUTATING.has(key)) await withRegistryLock(exec);
    else await exec();
  } catch (e) {
    if (e instanceof CrewError) o.fail(`error: ${e.message}`);
    else throw e;
  }
  return o;
}

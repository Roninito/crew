// Command router. The CLI and the HTTP API both call run(), so behavior is identical everywhere.
import { agentEnable, agentLint, agentNew, agentRemove, agentSet, agentsCmd } from "./agents";
import { emitCmd, eventsCmd, logCmd, logs, post, spendCmd } from "./comms";
import { type Crew, CrewError, Out, flag, parseArgs, withMutex } from "./core";
import { jobKill, jobRun, jobsCmd } from "./jobs";
import { installPack } from "./packs";
import { questionAnswer, questionList, questionNew, questionShow } from "./questions";
import { resume, statusCmd, stopAll, wakeCmd } from "./runner";
import { claim, release, renew, taskList, taskNew, taskShow, taskUpdate } from "./tasks";
import { audit, trace, verdict } from "./verify";

export const HELP = `crew: manager and central comms for a vault's agent team

Usage: crew <command> [args] [--vault <path>|--project <id>] [--as <agent|human>] [--json]
       A qualified id (e.g. crew claim art:T-0311) names its project too, same as --project.

Setup and machine service (machine-scoped, not project-scoped)
  init [path] [--id name]                  Scaffold crew/ in a folder and register it
  migrate <path>                           Bring an existing v0 vault into the registry
  projects                                 List registered projects: status, agents, spend
  project add <path> [--id name]           Register a folder that already has crew/
  project pause|resume <id>                Stop/resume waking agents; reads still work
  project remove <id>                      Unregister; files stay
  service install|uninstall|status         Run the machine service under launchd/systemd

Team
  status                                   What's running, what's stuck, what needs you
  agents                                   List agents
  agent new <name> --template worker --runner claude --model sonnet --can a,b
  agent lint <name>                        Check an agent definition (blanks, runner, locks)
  agent enable|disable <name>
  agent set <name> [--runner x] [--model x]  Change an existing agent's runner or model
  agent remove <name>                      Delete a disabled agent's folder
  install <pack.zip> [--force]             Install an agent pack into this project's crew/
  wake <agent> [--task id] [--reason text] Start a session now

Tasks
  task new "<title>" --needs a,b --accept "..." [--accept ...] [--check "cmd"] [--type asset|docs|code]
                    [--target path] [--parent id] [--tags a,b] [--desc text] [--protected] [--field k=v]
  task list [--status ready,claimed]
  task show <id>
  task update <id> [--status s] [--note text] [--accept text] [--check cmd] [--field k=v]
  claim <id> [--as human]      release <id>      renew <id>

Questions
  question new "<topic>" --text "<question>" [--task id]  An agent asks the human something
  question list [--status open|answered]       question show <id>
  question answer <id> "<answer>"              Answers it; wakes the asking agent

Comms
  post "<message>" [--task id] [--topic name]
  emit <domain.event> [--task id] [--data '{json}']
  log "<what you did>" [--task id]
  logs <agent> [--since 2h] | logs --all [--since 1d]
  events [--since 1h] [--limit 200]

Jobs
  job run --script <path> [--task id] [--lock name] [--timeout 20m] [--note "wake plan"] [-- args]
  jobs                         job kill <job-id>

Verification
  verdict <id> approve|reject|escalate|agree|disagree [--reason text] [--recommend approve|reject]
  audit <id>                   trace <id>

Control
  spend [<agent> <usd>]        stop --all        resume
  serve                        Run the crew server: --vault <path> for one project (v0), no
                                flag to run the machine service for every registered project
`;

// Commands that change shared state run under the cross-process mutex.
const MUTATING = new Set(["task.new", "task.update", "claim", "release", "renew", "post", "emit", "log", "agent.new", "agent.enable", "agent.disable", "agent.set", "agent.remove", "install", "verdict", "job.run", "spend", "resume", "question.new", "question.answer"]);

export async function run(c: Crew, argv: string[]): Promise<Out> {
  const a = parseArgs(argv);
  const o = new Out();
  const [cmd, sub] = a._;
  const key = ["task", "agent", "job", "question"].includes(cmd ?? "") ? `${cmd}.${sub ?? ""}` : (cmd ?? "");
  const exec = async (): Promise<void> => {
    switch (key) {
      case "status":
        return statusCmd(c, o);
      case "agents":
        return agentsCmd(c, o);
      case "agent.new":
        return agentNew(c, a, o);
      case "agent.lint":
        return agentLint(c, a, o);
      case "agent.enable":
        return agentEnable(c, a, o, true);
      case "agent.disable":
        return agentEnable(c, a, o, false);
      case "agent.set":
        return agentSet(c, a, o);
      case "agent.remove":
        return agentRemove(c, a, o);
      case "install":
        return installPack(c, a, o);
      case "wake":
        return wakeCmd(c, a, o);
      case "task.new":
        return taskNew(c, a, o);
      case "task.list":
        return taskList(c, a, o);
      case "task.show":
        return taskShow(c, a._[2] ?? "", o);
      case "task.update":
        return taskUpdate(c, a, o);
      case "claim":
        return claim(c, a, o);
      case "release":
        return release(c, a, o);
      case "renew":
        return renew(c, a, o);
      case "question.new":
        return questionNew(c, a, o);
      case "question.list":
        return questionList(c, a, o);
      case "question.show":
        return questionShow(c, a._[2] ?? "", o);
      case "question.answer":
        return questionAnswer(c, a, o);
      case "post":
        return post(c, a, o);
      case "emit":
        return emitCmd(c, a, o);
      case "log":
        return logCmd(c, a, o);
      case "logs":
        return logs(c, a, o);
      case "events":
        return eventsCmd(c, a, o);
      case "job.run":
        return jobRun(c, a, o);
      case "jobs":
        return jobsCmd(c, o);
      case "job.kill":
        return jobKill(c, a._[2] ?? "", o, flag(a, "as") ?? process.env.CREW_AGENT ?? "human");
      case "verdict":
        return verdict(c, a, o);
      case "audit":
        return audit(c, a, o);
      case "trace":
        return trace(c, a, o);
      case "spend":
        return spendCmd(c, a, o);
      case "stop":
        if (flag(a, "all") !== "true") throw new CrewError("Use crew stop --all to stop every session and job.");
        return stopAll(c, a, o);
      case "resume":
        return resume(c, a, o);
      case "":
      case "help":
        o.say(HELP);
        return;
      default:
        throw new CrewError(`Unknown command "${argv.join(" ")}". Run crew help.`);
    }
  };
  try {
    if (MUTATING.has(key)) await withMutex(c, exec);
    else await exec();
  } catch (e) {
    if (e instanceof CrewError) o.fail(`error: ${e.message}`);
    else throw e;
  }
  return o;
}

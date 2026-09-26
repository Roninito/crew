---
name: crew-manager
description: Run and supervise the vault's AI agent team through the crew CLI. Use this skill whenever the user mentions crew, Wrangler, agents in the vault, the board, tasks, the blackboard, agent logs, jobs, reviews, verdicts, traces, or the crew wiki, and whenever they ask to create or design an agent, plan or assign work, check what agents are doing, audit work against its spec, or take on a task alongside the agents, even if they don't say "crew". If there's no crew/crew.md in this vault yet, this isn't set up — use wrangler-setup instead (https://raw.githubusercontent.com/roninito/crew/main/skill/wrangler-setup/SKILL.md).
---

# Crew manager

You are the human's copilot for running a team of AI agents inside their Obsidian vault. The `crew` CLI is the manager and central comms service for that team. Wrangler is the Obsidian plugin that shows crew's state as views. You work through crew, never around it.

## Ground rules

- **Go through crew for shared state.** Never edit files under `crew/tasks/`, `crew/events/`, `crew/blackboard/`, `crew/jobs/` or another agent's folder directly. Use `crew` commands. crew is the single writer.
- **You may edit** agent definitions you are creating or changing (`crew/agents/<name>/agent.md`), templates, and wiki pages.
- **You act as the human.** Commands run as `human` unless `--as` says otherwise. Only use `--as <agent>` when the human asks you to act for a specific agent.
- **Always link task IDs.** Write tasks as `[[T-0142]]` in anything you write.
- **Check crew first.** Run `crew status`. If the server isn't running, commands still work, but agents won't wake. Suggest opening Wrangler or running `crew serve`.
- **Report plainly.** Lead with what needs the human, then what's running, then what finished.

## Core commands

| Need | Command |
| --- | --- |
| Team overview | `crew status` |
| List agents | `crew agents` |
| An agent's recent work | `crew logs <agent> --since 2h` |
| Every agent's recent work | `crew logs --all --since 1d` |
| Recent events | `crew events --since 1h` |
| Check work against its spec | `crew audit <task-id>` |
| Full history of a task | `crew trace <task-id>`, then read `crew/traces/<task-id>.md` |
| Create a task | `crew task new "<title>" --needs <caps> --type <asset\|docs\|code> --accept "<criterion>" [--accept ...] [--check "<cmd>"] [--parent <id>] [--tags a,b]` |
| See tasks | `crew task list [--status ready,review]`, `crew task show <id>` |
| Update a task | `crew task update <id> --status <status> --note "<note>"` |
| Take a task for the human | `crew claim <id>` |
| Approve or reject escalated work | `crew verdict <id> approve` / `crew verdict <id> reject --reason "..."` |
| Answer a sampled approval | `crew verdict <id> agree` / `crew verdict <id> disagree --reason "..."` |
| Post to the blackboard | `crew post "<message>" --task <id> --topic <topic>` |
| Send an event | `crew emit <domain.event> --task <id> --data '<json>'` |
| Wake an agent now | `crew wake <agent> [--task <id>]` |
| Remove an agent | `crew agent disable <name>` then `crew agent remove <name>` (refuses while enabled; doesn't touch its claimed tasks) |
| Jobs | `crew jobs`, `crew job kill <job-id>` |
| Spend | `crew spend` |
| Stop everything | `crew stop --all` (only when the human asks), then `crew resume` |

Add `--json` to any command for structured output.

## Workflows

### Check on the team

1. Run `crew status`.
2. For any agent that is blocked, over budget, or failing, run `crew logs <agent> --since 2h`.
3. Summarize in this order: needs the human (review items, blocked tasks, budget stops), running now, finished since last check. Keep it short and link every task.

### Audit work against its spec

1. Run `crew audit <task-id>`. It runs the task's checks in its work tree and lists the acceptance criteria.
2. Read the task note and the files in the work tree, then compare them yourself against each criterion and the wiki pages named in the worker's agent.md.
3. Report each gap with evidence: what the criterion says, what the work shows, and where.
4. If the human agrees it's wrong: `crew verdict <id> reject --reason "<specific fix>"`. The worker wakes with the reason.

Look for problems humans miss when switching tasks: results that contradict other tasks, naming that breaks wiki conventions, criteria quietly narrowed, and claims in notes or logs that the files don't support.

### Plan work

1. Break the goal into tasks small enough for one agent and one capability.
2. Give every task at least one checkable acceptance criterion, and a `--check` command for each one a script can verify. A task without criteria stays in inbox.
3. Set `--needs` to capabilities an existing agent has (`crew agents`). If none fits, design a new agent or tell the human.
4. Set `--type` so the right approval tier applies, and tag protected work (`--tags canon-lore`, `released-builds`, `main-branch-config`).
5. Link subtasks to the goal with `--parent`.

### Design a new agent

1. Agree the agent's job with the human in one sentence, plus its capabilities, runner and model.
2. Scaffold it: `bash crew/skills/crew-manager/scripts/new-agent.sh <name> <template> <runner> <model> <caps>`. Templates: worker, bridge, verifier, planner, watcher.
3. Open `crew/agents/<name>/agent.md` and replace every `{{BLANK: ...}}` marker. Write directives as short imperative rules. Keep the standard workflow section.
4. Run `crew agent lint <name>` and fix every error.
5. Show the human the finished agent.md, then run `crew agent enable <name>`.

Good directives name the agent's outputs and where they go, the apps or scripts it drives, which wiki pages it follows, when to start a job instead of working in-session, and what to do when blocked.

### Work alongside the agents

When the human takes a task, `crew claim <id>` puts it in their name and creates a work tree. Help them do it, then `crew task update <id> --status verify --note "<evidence>"` so the verifier checks it like any other work.

### Keep the wiki current

When a decision or convention comes up that agents need, write or update a page in `crew/wiki/` (`scripts/new-wiki-page.sh` creates one) and link it from the relevant tasks. Add the page to the `wiki:` list of every agent it applies to.

## How agents work (reference)

Every agent follows the same loop: wake on an event or schedule, read memory, job notes and wiki pages, claim a task, work in an isolated work tree, start long work as a Bun or Python job with `crew job run` and end the session, wake on `job.succeeded`, `job.failed` or `job.timeout`, then move the task to verify. A verifier agent approves, rejects, or escalates. crew's trust policy decides whether an approval applies directly or goes to the human: protected work always escalates, and each task type earns auto-approval through the human's track record of agreeing with the verifier. Nothing merges into the live project until approved.

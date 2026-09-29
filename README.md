# crew + Wrangler

A documentation-driven agent team for an Obsidian vault. [Website](https://roninito.github.io/crew/) · [Releases](https://github.com/roninito/crew/releases)

- **crew** (`packages/crew`) is a standalone Bun CLI and server: the team's manager and central comms. It owns tasks, claims, the blackboard, events, jobs, locks, budgets, verification, traces, and now questions (an agent asking the human something). It runs with or without Obsidian.
- **Wrangler** (`packages/wrangler`) is the Obsidian plugin. It starts or attaches to a crew server and shows the team as views: crew sidebar, board, review inbox (approvals and open agent questions), blackboard feed, jobs, an all-crews overview, and a status bar.
- **crew-manager** (`skill/crew-manager`) is the skill that teaches your copilot (Claude, Copilot, OpenCode) to run the team, once crew is set up.
- **wrangler-setup** (`skill/wrangler-setup`) is the skill that teaches your copilot to install Wrangler and bootstrap crew in a vault that doesn't have them yet.

The full design is in [docs/SPEC.md](docs/SPEC.md).

## One shared service, many projects

Every vault or repo you set up with crew is a **project**, registered by id in a machine-wide registry (`~/.crew/projects.md`). A single `crew serve` (no `--vault`) can dispatch every registered project at once, on one port -- so a laptop with three vaults runs one background process, not three. Each project still keeps its own files, its own event log, and its own mutex; nothing is shared between projects except visibility. A qualified id names a project inline, from anywhere: `crew claim art:T-0311`, `crew task show second-brain:Q-0002`, same resolution tier as `--project`.

Projects get into the registry one of three ways, and Wrangler picks the right one automatically:

- **`crew init [path]`** scaffolds a fresh `crew/` folder and registers it -- any folder, not just an Obsidian vault.
- **`crew migrate <path>`** brings an *existing* v0 vault (one that already has `crew/` but predates the machine service) into the registry: stops its own standalone server if one's running, drops the now-unused `api.port` from its `crew.md`, keeps its token.
- Enabling **Wrangler** in a vault does whichever of the two applies automatically, then attaches to a healthy shared `crew serve` if one's already running -- falling back to starting its own standalone server only if no shared service is reachable.

```bash
crew serve                      # the machine service: dispatches every registered active project
crew projects                   # status, agents, spend, per project
crew project pause|resume <id>  # stop/resume dispatching one project; files and reads are untouched
crew service install|uninstall|status   # run the machine service itself under launchd/systemd
```

A vault that only ever wants to stand alone doesn't have to think about any of this -- `crew serve --vault <path>` (the original v0 mode) still works exactly as before, and Wrangler falls back to it automatically when no shared service is running.

## Quick start

Easiest: point your copilot (in the vault, or anywhere with shell access) at the setup skill and let it do the rest --

> Read https://raw.githubusercontent.com/roninito/crew/main/skill/wrangler-setup/SKILL.md and set up crew in this vault.

Or do it by hand. Wrangler isn't in the Obsidian community plugin directory yet, so install it with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/roninito/crew/main/scripts/install-wrangler.sh | bash -s -- ~/Vaults/Studio
```

That also installs the `crew` command itself to `~/.local/bin/crew` (add it to your PATH if the script tells you to), so `crew status` works from any terminal, not just from inside Wrangler.

Then enable **Wrangler** in Obsidian (Settings, Community plugins). No Bun install, no source checkout: the first time it's enabled in a vault, Wrangler creates the `crew/` folder layout, generates the API token, and connects it to a server (attaching to a shared one if it finds it healthy, otherwise starting its own). That's the whole install. Settings has a "Check for updates" button that refreshes both the plugin and this vault's `crew` binary from the latest release.

To keep agents working with Obsidian closed, run crew as a service. For a single vault:

```bash
scripts/service.sh install ~/Vaults/Studio  # launchd on macOS, systemd --user on Linux
```

For several vaults/projects sharing one machine, install the machine service instead and register each project into it (`crew init`/`crew migrate`, above):

```bash
crew service install
```

Point your copilot at `crew/skills/crew-manager/SKILL.md` in the vault.

## First agent

```bash
cd ~/Vaults/Studio
bash crew/skills/crew-manager/scripts/new-agent.sh blender worker claude sonnet blender,mesh,rig
# fill every {{BLANK: ...}} in crew/agents/blender/agent.md (or ask your copilot to)
crew agent lint blender && crew agent enable blender
crew task new "Low-poly crate, 3 variants" --needs blender,mesh --type asset \
  --accept "under 2,000 triangles each" --check "test -n \"\$(ls *.glb 2>/dev/null)\""
```

With the server running, the task's `task.ready` event wakes the blender agent.

## Agent packs

Ready-made teams you install instead of designing agents one by one -- 3D asset
pipeline, long-form content, web experiences, code maintenance, releases. See
[docs/agent-packs.md](docs/agent-packs.md) for the catalog, install rules, and how to
build your own.

```bash
cd ~/Vaults/Studio
crew install packs/asset-pipeline.zip --force
```

## How the pieces talk

- Everything is files in `crew/` inside each project. crew is the only writer of shared state; agents, Wrangler, your copilot and other tools go through the CLI or the HTTP API.
- The HTTP API listens on `127.0.0.1`, token in `crew/crew.md` (v0) or `~/.crew/crew.md` (machine service). `POST /cmd {"argv": [...], "as": "human", "project"?: "id"}` runs any CLI command. `GET /status`, `/tasks`, `/agents`, `/jobs`, `/review`, `/questions`, `/events` return JSON, scoped to one project (v0, or machine mode under `/p/<id>/...`). The machine service additionally serves `GET /projects` (every registered project) and an aggregate `GET /status` keyed by project id. `/stream` is a WebSocket of live events, filterable by `?project=` in machine mode. `GET /` on either server is a small read-only dashboard for glancing at status from a plain browser -- paste the token once, it's remembered locally.
- Agents are launched by crew with their runner (Claude Code, OpenCode, or any command in `crew.md` runners), with `CREW_AGENT`, `CREW_VAULT` and `CREW_TASK` set. Every agent session still does plain direct file access to its own project regardless of v0 or machine dispatch -- nothing crosses a process/network boundary to run a session.
- Long work runs as jobs: `crew job run --script x.py` starts it detached, the agent ends its session, and crew wakes it on `job.succeeded`, `job.failed` or `job.timeout`. Job scripts get helpers: `from crew import emit, progress, result, renew` in Python, or `packages/helpers/bun/crew.ts` in Bun.
- An agent that needs an open-ended answer from you, not a deliverable to verify, asks with `crew question new "<topic>" --text "..."` -- it shows up in Wrangler's Review view with an Answer box, and `crew question answer <id> "..."` wakes just that agent with the answer.

## Scripts

| Script | What it does |
| --- | --- |
| `scripts/install.sh` | Checks Bun, installs dependencies, installs the `crew` command |
| `scripts/init-vault.sh <vault> [--assets dir]` | Creates the crew folder layout, token, templates, wiki and skill in a vault |
| `scripts/install-plugin.sh <vault>` | Builds Wrangler and installs it into the vault |
| `scripts/service.sh install\|uninstall\|status <vault>` | Runs a single vault's own v0 server as a launchd or systemd service |
| `crew service install\|uninstall\|status` | Runs the machine service (many registered projects, one process) as a launchd or systemd service -- built into the `crew` binary, not a script |
| `scripts/install-wrangler.sh <vault>` | Downloads Wrangler's latest release into a vault. Standalone — works via `curl \| bash`, no checkout needed |
| `scripts/new-wiki-page.sh <vault> <path> "<title>"` | Creates a wiki page |
| `scripts/smoke-test.sh` | End-to-end test in a throwaway vault, using the `dryrun` runner |
| `scripts/build-release.sh` | Builds crew binaries for every platform and the Wrangler plugin bundle into `dist/` |
| `skill/crew-manager/scripts/new-agent.sh` | Scaffolds an agent from a template and lists the blanks to fill |

`scripts/install.sh`, `scripts/init-vault.sh` and `scripts/install-plugin.sh` are for developing crew and Wrangler from this checkout. End users don't need them — see Quick start.

## Layout

```
packages/crew/        Bun CLI + server (TypeScript, strict)
  bin/crew.ts         entry point; also resolves qualified ids (art:T-0311) and --project
  src/commands.ts     command router shared by CLI and HTTP API
  src/server.ts       per-project dispatcher (v0 and machine service share this), scheduler,
                      sweeper, anomalies, API, live stream
  src/service.ts      the machine service: one Bun.serve dispatching every registered project
  src/registry.ts     ~/.crew/projects.md: register/find/list projects, qualified-id splitting
  src/machine.ts      ~/.crew home (settings, machine token, live-service info)
  src/migrate.ts      brings an existing v0 vault into the registry
  src/init.ts         scaffolds crew/ in a folder and registers it
  src/tasks.ts        tasks, claims, work trees
  src/questions.ts    an agent asks the human something; human answers, agent wakes
  src/agents.ts       scaffold, lint, enable
  src/jobs.ts         job runner with locks and guaranteed completion events
  src/runner.ts       agent sessions, wake prompts, budgets, status, kill switch
  src/verify.ts       verdicts, trust policy, audit, trace
  src/comms.ts        blackboard, events, logs, spend
packages/helpers/     Bun and Python helpers for job scripts
packages/wrangler/     Obsidian plugin
skill/crew-manager/   copilot skill
vault-template/crew/  crew.md, agent templates, example job scripts, wiki starter
docs/SPEC.md          the spec
docs/agent-packs.md   installable agent teams: catalog, rules, building your own
```

## Development

```bash
bun run typecheck
bun run smoke
```

See [CLAUDE.md](CLAUDE.md) for conventions when handing work to coding agents.

## Releasing

Pushing a tag like `v0.1.0` runs `.github/workflows/release.yml`, which builds crew for macOS, Linux and Windows and the Wrangler plugin bundle (`scripts/build-release.sh`), then publishes them as release assets. Wrangler downloads its matching `crew-<platform>` binary from the latest release the first time it needs to start a server without a `crewCliPath` override set.

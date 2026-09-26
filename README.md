# crew + Wrangler

A documentation-driven agent team for an Obsidian vault.

- **crew** (`packages/crew`) is a standalone Bun CLI and server: the team's manager and central comms. It owns tasks, claims, the blackboard, events, jobs, locks, budgets, verification and traces. It runs with or without Obsidian.
- **Wrangler** (`packages/wrangler`) is the Obsidian plugin. It starts or attaches to the crew server for the vault and shows the team as views: crew sidebar, board, review inbox, blackboard feed, jobs, and a status bar.
- **crew-manager** (`skill/crew-manager`) is the skill that teaches your copilot (Claude, Copilot, OpenCode) to run the team.

The full design is in [docs/SPEC.md](docs/SPEC.md).

## Quick start

Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/roninito/crew/releases/latest) into `<vault>/.obsidian/plugins/wrangler/`, then enable **Wrangler** in Obsidian (Settings, Community plugins). No Bun install, no source checkout: the first time it's enabled in a vault, Wrangler creates the `crew/` folder layout, generates the API token, and downloads the right `crew` binary for your OS from GitHub Releases on its own, then starts the server. That's the whole install.

To keep agents working with Obsidian closed, run crew as a service instead:

```bash
scripts/service.sh install ~/Vaults/Studio  # launchd on macOS, systemd --user on Linux
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

## How the pieces talk

- Everything is files in `crew/` inside the vault. crew is the only writer of shared state; agents, Wrangler, your copilot and other tools go through the CLI or the HTTP API.
- The HTTP API listens on `127.0.0.1` at the port in `crew/crew.md`, with the token stored there. `POST /cmd {"argv": [...], "as": "human"}` runs any CLI command. `GET /status`, `/tasks`, `/agents`, `/jobs`, `/review`, `/events` return JSON. `/stream` is a WebSocket of live events.
- Agents are launched by crew with their runner (Claude Code, OpenCode, or any command in `crew.md` runners), with `CREW_AGENT`, `CREW_VAULT` and `CREW_TASK` set.
- Long work runs as jobs: `crew job run --script x.py` starts it detached, the agent ends its session, and crew wakes it on `job.succeeded`, `job.failed` or `job.timeout`. Job scripts get helpers: `from crew import emit, progress, result, renew` in Python, or `packages/helpers/bun/crew.ts` in Bun.

## Scripts

| Script | What it does |
| --- | --- |
| `scripts/install.sh` | Checks Bun, installs dependencies, installs the `crew` command |
| `scripts/init-vault.sh <vault> [--assets dir]` | Creates the crew folder layout, token, templates, wiki and skill in a vault |
| `scripts/install-plugin.sh <vault>` | Builds Wrangler and installs it into the vault |
| `scripts/service.sh install\|uninstall\|status <vault>` | Runs crew as a launchd or systemd service |
| `scripts/new-wiki-page.sh <vault> <path> "<title>"` | Creates a wiki page |
| `scripts/smoke-test.sh` | End-to-end test in a throwaway vault, using the `dryrun` runner |
| `scripts/build-release.sh` | Builds crew binaries for every platform and the Wrangler plugin bundle into `dist/` |
| `skill/crew-manager/scripts/new-agent.sh` | Scaffolds an agent from a template and lists the blanks to fill |

`scripts/install.sh`, `scripts/init-vault.sh` and `scripts/install-plugin.sh` are for developing crew and Wrangler from this checkout. End users don't need them — see Quick start.

## Layout

```
packages/crew/        Bun CLI + server (TypeScript, strict)
  bin/crew.ts         entry point
  src/commands.ts     command router shared by CLI and HTTP API
  src/server.ts       dispatcher, scheduler, sweeper, anomalies, API, live stream
  src/tasks.ts        tasks, claims, work trees
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
```

## Development

```bash
bun run typecheck
bun run smoke
```

See [CLAUDE.md](CLAUDE.md) for conventions when handing work to coding agents.

## Releasing

Pushing a tag like `v0.1.0` runs `.github/workflows/release.yml`, which builds crew for macOS, Linux and Windows and the Wrangler plugin bundle (`scripts/build-release.sh`), then publishes them as release assets. Wrangler downloads its matching `crew-<platform>` binary from the latest release the first time it needs to start a server without a `crewCliPath` override set.

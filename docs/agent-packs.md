# Agent packs

Ready-made agent teams you install into a project instead of designing agents from
scratch. A pack is a zip with agent definitions, their skill scripts, wiki
conventions, and a manifest -- `crew install` copies it into your project's `crew/`,
lints every agent, and enables the ones that pass.

```bash
cd /path/to/your/project
crew install packs/asset-pipeline.zip --force
crew agents   # what's installed, enabled or not
```

Rules that apply to every pack:

- **Project-only.** Install resolves the project from the directory you stand in. With
  no `crew/` nearby it fails rather than installing globally. `--force` overwrites
  agents that already exist (the old version is backed up to
  `crew/.state/pack-backups/` first); without it, existing agents are skipped.
- **Same mechanics everywhere.** Every pack below routes work through `task.needs`,
  keeps per-stage state in the task's `## Pipeline` block (`--field key=value`),
  gates judgment calls on human `review-*` tags, and parks finished or fix-by-hand
  work on terminal `done`/`stuck` tags no agent covers. Learn one pack and you know
  them all; the conventions page each pack installs (`wiki/conventions/<pack>.md`)
  documents its own routing table.
- **Adapters are config, not code.** Where a pack calls outside services, the Space
  ids, commands, and tokens come from environment variables documented in the pack's
  wiki page -- switching providers never means editing an agent.

## The packs

| Pack | For | Agents (`can`) | Needs from you |
| --- | --- | --- | --- |
| `asset-pipeline` (0.2.0) | Game-ready 3D assets: concept → sheet → GLB | planner, imager (`image`), sheeter (`sheet`), modeler (`model3d`) | `HF_TOKEN` in the crew server's environment; HF GPU Spaces (imager/sheet/3D). Human reviews at every `review-*` gate. |
| `content-pipeline` (0.1.0) | Long-form articles: angle → research → draft → factcheck → polish | angle-finder, researcher, drafter, factchecker, polisher | Nothing -- scripts are stdlib-only. Human reviews angle, outline, final. |
| `web-experience` (0.1.0) | Pages from brief to motion: static, scroll, or 3D backgrounds | briefer, builder, motion | Playwright + Chromium for screenshots/budgets (`lighthouse` optional, for the score gate); node/npm for scaffolding. Human reviews brief, visuals, final. |
| `code-maintenance` (0.1.0) | Bug fixes with a red test written before every fix | triager, reproducer, fixer, tester | The repo's test command (recorded per task, never guessed). Human reviews each fix. |
| `release` (0.1.0) | Version, changelog, checks, publish -- with approval between prepare and publish | releaser (`release`, `publish`) | A git repo with tags. Human approves at `review-release`; publish needs that evidence. |

Details per pack -- routing tables, pipeline fields, adapter env vars -- live in the
wiki page each pack installs, e.g. `crew/wiki/conventions/pipeline.md` after installing
the asset pack.

## Using packs in Obsidian projects and outside

Packs work anywhere crew works: an Obsidian vault, a git repo, or a plain folder. The
flow is the same:

1. `crew init` (or Wrangler's automatic setup) gives the project its `crew/`.
2. `crew install <pack.zip>` adds the team. Combine packs freely -- capabilities
   (`can`) are matched by name, so an installed pack only picks up tasks tagged for it.
3. Create the first task with the pack's entry `needs` (e.g. `--needs plan` for assets,
   `--needs brief` for a page, `--needs triage` for a bug) and acceptance criteria.
4. Watch it move on Wrangler's board; answer the human gates in the review inbox.

Two packs can ship an agent with the same name (this repo's smoke test hits exactly
this with `tester`). Install skips the collision and tells you; `--force` overwrites
with a backup. If two *enabled* agents ever cover the same `can` tag, the first to
claim a task wins -- check `crew agents` when combining packs and disable the
overlap you don't want.

`crew serve` needs no restart for packs: installing is plain files, and lint state is
read per wake.

## Building your own pack

```
my-pack/
  pack.json                    # {name, version, agents: [{name, enabled}]}
  agents/<name>/agent.md       # real crew frontmatter: name == folder, can, subscribes
  agents/<name>/memory.md      # optional; a starter is created if missing
  agents/<name>/skills/...     # optional; adapter scripts travel with the agent
  wiki/...                     # optional; copied in (missing files only, unless --force)
```

Zip it (`cd my-pack && zip -qr ../my-pack.zip .`) and `crew install ../my-pack.zip`.
`frontmatter.enabled` (or the `pack.json` override) is the desired state, applied only
when the agent passes `crew agent lint` -- blanks, unknown runners, undeclared locks,
or a name mismatch stay disabled with the reason printed. Keep `can` tags namespaced
to your pack's domain so combining packs never double-claims, and put every external
dependency (tokens, endpoints, commands) behind environment variables your wiki page
documents.

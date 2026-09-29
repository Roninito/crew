# Release conventions

How releases ship. One task per release. `task.needs` is the routing field, and one
agent (`releaser`, `can: [release, publish]`) works both sides of a human gate:
prepare on `release`, publish on `publish`, never without approval between them.
`done` and `stuck` are terminal tags no agent covers.

## Routing

| Stage | `needs` | Claimed by | On finish, sets |
| --- | --- | --- | --- |
| Created | `release` | releaser | notes drafted, checks green → `needs: review-release` |
| Release review | `review-release` | you (notes + check output) | approve → `needs: publish` · reject → `needs: release` with `feedback` |
| Publish | `publish` | releaser | tag + artifact confirmed → `--status verify` (normal approval finishes it) |

A red release check is not a `stuck`: the task goes `blocked` naming the failing
check, because the code needs work, not the release process.

## Rules

- Publish requires evidence of human approval in the task notes. No evidence, no
  publish -- the releaser asks instead.
- Never publish from a dirty tree. `git status` clean before tagging.
- Changelog entries trace to commits. `draft-notes.py` drafts from `git log`; the
  releaser shapes it into Highlights / Fixes / Breaking changes.

## Pipeline fields

Stored in the task's `## Pipeline` block, written with `crew task update <id> --field
key=value` and read via `crew task show <id>`.

| Field | Set by | Purpose |
| --- | --- | --- |
| `version` | human, at creation | The release identifier, e.g. `v0.24.0` |
| `notes` | releaser | Path to the drafted notes file |
| `checks` | releaser, on handoff | Which release checks ran green |
| `feedback` | reviewer, on reject | What blocks the release |
| `attempts` | releaser, on finish | `attempts.release`, `attempts.publish` |

## Adapter config

| Stage | Script | Purpose |
| --- | --- | --- |
| Release | `releaser/skills/scripts/draft-notes.py` | `git log` since the last tag into a notes draft, exit 1 outside a repo |

No secrets are needed for this pack.

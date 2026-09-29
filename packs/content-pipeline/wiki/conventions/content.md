# Content conventions

How long-form pieces move through the team. One task per article. `task.needs` is the
routing field: an agent claims a task when its tag matches `needs`, does its job, then
rewrites `needs` to the next stage and marks the task ready
(`crew task update <id> --needs <next> --status ready`). `review-*` tags are human
gates in the review inbox; `done` and `stuck` are terminal tags no agent covers -- the
task simply waits for the human on the board.

## Routing

| Stage | `needs` | Claimed by | On finish, sets |
| --- | --- | --- | --- |
| Created | `angle` | angle-finder | `needs: review-angle` |
| Angle review | `review-angle` | you, in the review inbox | approve → `needs: research` · edit → stays `review-angle` · reject → `needs: angle` with `feedback` |
| Research | `research` | researcher | `needs: review-outline` |
| Outline review | `review-outline` | you | approve → `needs: draft` · reject → `needs: research` with `feedback` |
| Draft | `draft` | drafter | `needs: factcheck` |
| Factcheck | `factcheck` | factchecker | all pass → `needs: polish` · any fail → `needs: draft` with `feedback` |
| Polish | `polish` | polisher | `needs: review-final` |
| Final review | `review-final` | you | approve → `needs: done` · reject → earlier stage with `feedback` |

## Reject rules

- Default retry target is one stage back (in place). A reviewer can send it further back
  when the fault is upstream (a draft that fails factcheck over and over usually means
  the outline was wrong, not the drafting).
- Every reject sets `feedback` on the task to a short reason. The agent that picks the
  task back up reads it before regenerating.
- Every stage advance increments `attempts.<stage>`. Past 3 attempts on one stage, the
  task goes to `needs: stuck` instead of looping, for you to fix by hand.

## Pipeline fields

Stored in the task's `## Pipeline` block, written with `crew task update <id> --field
key=value` and read via `crew task show <id>`. An agent updates only its own stage's
output fields and `needs`; it never touches fields another stage owns.

| Field | Set by | Purpose |
| --- | --- | --- |
| `thesis` | angle-finder | One sentence: what the piece argues |
| `audience` | angle-finder | Who it's for, specifically |
| `non-goals` | angle-finder | What the piece explicitly does NOT cover |
| `sources` | researcher | One `title -- url -- sources/<n>.txt` line each; text saved on disk |
| `outline` | researcher | Section headings with 2-3 bullet notes each, no full sentences |
| `claims` | factchecker | One `claim -- source n -- PASS/FAIL -- quote-or-reason` line each |
| `feedback` | reviewer or factchecker, on reject | Why this stage failed |
| `attempts` | each agent, on finish | Per-stage counts, e.g. `attempts.draft: 2` |
| `artifacts` | drafter, polisher, on finish | Paths: `artifacts.draft`, `artifacts.final` |

## Citation rule

Every factual claim in the draft carries `[src: <n>]` matching the `sources` list.
The factchecker verifies each marker against the saved file, never from memory. A
claim without a marker is a draft failure. The polisher keeps every marker exactly
where it is -- meaning is frozen at polish time.

## Adapter config

Research and verification never hardcode providers. Each stage's script is stdlib-only
Python with no keys or accounts needed:

| Stage | Script | Purpose |
| --- | --- | --- |
| Research | `researcher/skills/scripts/fetch-extract.py` | Fetch a URL, extract readable text to `sources/<n>.txt` |
| Factcheck | `factchecker/skills/scripts/check-links.py` | Every link in the draft must resolve; exit 1 otherwise |
| Draft, polish | `drafter/skills/scripts/lint-md.py` | Headings, whitespace, line length; exit 1 otherwise |

No `HF_TOKEN` or other secrets are needed for this pack -- override a script per call
without touching code.

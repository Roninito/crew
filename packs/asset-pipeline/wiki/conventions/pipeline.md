# Pipeline conventions

How asset tasks move through the team. Set by the planner's `target` field, which the
human can fix at creation (`crew task new ... --field target=image`) or let the
planner infer from the request.

## Routing

One task per asset. `task.needs` is the routing field: an agent claims a task when its
tag matches `needs`, does its job, then rewrites `needs` to the next stage and marks
the task ready (`crew task update <id> --needs <next> --status ready`). `review-*`
tags are human gates in the review inbox; `done` and `stuck` are terminal tags no agent
covers -- the task simply waits for the human on the board.

| Stage | `needs` | Claimed by | On finish, sets |
| --- | --- | --- | --- |
| Created | `plan` | planner | `needs: review-prompt` |
| Prompt review | `review-prompt` | you, in the review inbox | approve → `needs: image` · edit → stays `review-prompt` · reject → `needs: plan` with `feedback` |
| Imaging | `image` | imager | `needs: review-image` |
| Image review | `review-image` | you | approve → `needs: sheet`, or `needs: done` when `target: image` · reject → `needs: image` with `feedback` |
| Sheet gen | `sheet` | sheeter | `needs: review-sheet` |
| Sheet review | `review-sheet` | you | approve → `needs: model3d`, or `needs: done` when `target: sheet` · reject → `needs: image` or `needs: sheet` with `feedback` |
| Model gen | `model3d` | modeler | `needs: review-model` |
| Model review | `review-model` | you | approve → `needs: done`, writes manifest · reject → earlier stage or `needs: stuck` |

## Reject rules

- Default retry target is one stage back (in place). A reviewer can send it further back
  when the fault is upstream (a bad sheet usually means the concept image was wrong).
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
| `target` | human or planner | `image`, `sheet`, or `model`: how far down the pipeline this task goes |
| `assetId` | planner, on first claim | Links to the manifest entry, e.g. `ship.ferryman-mk2` |
| `kind` | planner | `ship`, `missile`, `drone`, `station-module`, `hero-station` |
| `faction` | planner, from the request | Selects the art-bible reference set |
| `promptEnhanced` | planner | The prompt the imager uses, in fixed SUBJECT/KIND/FACTION/ANGLE/STYLE/DETAILS/NEGATIVE format |
| `feedback` | reviewer, on reject | Why this stage failed |
| `attempts` | each generating agent, on finish | Per-stage counts, e.g. `attempts.image: 2` |
| `artifacts` | each generating agent, on finish | Paths to what it produced this round |

## Prompt formatting

**Planner's enhanced prompt** (`promptEnhanced`), plain text with labeled parts:

```
SUBJECT: <what the request asked for, one line>
KIND: ship | missile | drone | station-module | hero-station
FACTION: <faction id, sets style reference set>
ANGLE: 3/4 front, slight low angle
STYLE: <2-3 words from the faction's art bible>
DETAILS: <specific features the request named, nothing invented>
NEGATIVE: text, watermark, blurry, extra limbs, duplicate
```

**Imager's call.** SUBJECT + ANGLE + STYLE + DETAILS as the prompt, the faction's
stored reference images as conditioning, NEGATIVE as the negative prompt. One image out.

**Sheeter's call.** The accepted concept image plus a fixed instruction, not a free prompt:

```
Turn this concept into an orthographic turnaround sheet: front, side, back, three-quarter.
Keep proportions, palette, and surface detail identical across all four views.
No background, no shadow, flat lighting.
```

**Modeler's call.** The front quadrant of the sheet (view 0) to `roninito/trellis-2`
with no text prompt; `extract_glb` at the decimation target writes the GLB, whose
triangle count is checked against the kind's budget by parsing it directly.

## Adapter config

Generation never hardcodes providers. Each stage's script reads its Space id from the
environment (with the default shown) and `HF_TOKEN` for auth; the Space wakes itself
if asleep (ZeroGPU bills per GPU-second while awake):

| Stage | Script | Env var | Default Space |
| --- | --- | --- | --- |
| Imaging | `imager/skills/scripts/generate-image.py` | `HF_IMAGER_SPACE` | `roninito/flux-schnell-demo` |
| Sheet gen | `sheeter/skills/scripts/edit-sheet.py` | `HF_SHEETER_SPACE` | `roninito/flux2-klein-demo` |
| Model gen | `modeler/skills/scripts/model-from-sheet.py` | `HF_MODELER_SPACE` | `roninito/trellis-2` |

`HF_TOKEN` must be in the crew server's environment (it already is for terminal-run
servers logged in with `hf auth`; add it to the launchd/systemd unit for service
mode). Override a Space per call without touching code:
`HF_IMAGER_SPACE=roninito/z-image-turbo-demo python3 .../generate-image.py ...`.

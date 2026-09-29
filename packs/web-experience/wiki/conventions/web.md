# Web conventions

How pages move through the team. One task per page or section. `task.needs` is the
routing field: an agent claims a task when its tag matches `needs`, does its job, then
rewrites `needs` to the next stage and marks the task ready
(`crew task update <id> --needs <next> --status ready`). `review-*` tags are human
gates in the review inbox; `done` and `stuck` are terminal tags no agent covers -- the
task simply waits for the human on the board.

## Routing

| Stage | `needs` | Claimed by | On finish, sets |
| --- | --- | --- | --- |
| Created | `brief` | briefer | `needs: review-brief` |
| Brief review | `review-brief` | you, in the review inbox | approve → `needs: build` · edit → stays `review-brief` · reject → `needs: brief` with `feedback` |
| Build | `build` | builder | `tier: static` → `needs: review-final`, else `needs: review-visual` |
| Visual review | `review-visual` | you (stills from `shots/build/`) | approve → `needs: motion` · reject → `needs: build` with `feedback` |
| Motion | `motion` | motion agent | `needs: review-final` |
| Final review | `review-final` | you (stills from `shots/motion/` + perf scores) | approve → `needs: done` · reject → earlier stage with `feedback` |

## Motion tiers

Set by the briefer in `tier`, honored by everyone downstream:

| Tier | What's allowed | Skips |
| --- | --- | --- |
| `static` | Semantic HTML + CSS (`animation-timeline`, transitions, `:hover`) | `review-visual` and `motion` -- straight to `review-final` |
| `motion` | Above plus Lenis smooth scroll + GSAP ScrollTrigger reveals/pins | Three.js |
| `immersive` | Above plus the fixed Three.js background canvas | Nothing |

## Reject rules

- Default retry target is one stage back (in place). A motion failure caused by missing
  markup hooks goes back to `build`, not sideways -- the motion agent never restructures
  markup to suit an effect.
- Every reject sets `feedback` on the task to a short reason.
- Every stage advance increments `attempts.<stage>`. Past 3 attempts on one stage, the
  task goes to `needs: stuck` instead of looping, for you to fix by hand.

## Pipeline fields

Stored in the task's `## Pipeline` block, written with `crew task update <id> --field
key=value` and read via `crew task show <id>`. An agent updates only its own stage's
output fields and `needs`; it never touches fields another stage owns.

| Field | Set by | Purpose |
| --- | --- | --- |
| `goal` | briefer | One sentence: what the page must achieve |
| `audience` | briefer | Who it's for, specifically |
| `sections` | briefer | One `name -- purpose -- content notes` line each |
| `tier` | briefer | `static`, `motion`, or `immersive` |
| `stack` | briefer | e.g. `static html`, `react`, `astro` |
| `feedback` | reviewer, on reject | Why this stage failed |
| `attempts` | each agent, on finish | Per-stage counts, e.g. `attempts.build: 2` |
| `artifacts` | builder, motion, on finish | Paths: `artifacts.dist`, `artifacts.final`, shot folders |
| `perf` | motion | Lighthouse + transfer scores from `perf-budget.py` |

## Budgets (asserted by `perf-budget.py`, judged by you)

Lighthouse performance ≥ 90 mobile, motion JS < 150KB transfer, no console errors,
readable with JS off, everything still under `prefers-reduced-motion`. Automated checks
assert numbers and file existence; humans judge look and feel at `review-visual` and
`review-final`.

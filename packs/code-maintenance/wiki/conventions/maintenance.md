# Maintenance conventions

How bug fixes move through the team. One task per bug. `task.needs` is the routing
field: an agent claims a task when its tag matches `needs`, does its job, then rewrites
`needs` to the next stage and marks the task ready
(`crew task update <id> --needs <next> --status ready`). `review-fix` is the human
gate; `done` and `stuck` are terminal tags no agent covers -- the task simply waits for
the human on the board.

## Routing

| Stage | `needs` | Claimed by | On finish, sets |
| --- | --- | --- | --- |
| Created | `triage` | triager | `needs: reproduce` (or `needs: stuck` for dup/not-a-bug/nothing-to-go-on) |
| Reproduce | `reproduce` | reproducer | red test written → `needs: fix` · unreproducible → `needs: stuck` |
| Fix | `fix` | fixer | minimal change, red test green → `needs: review-fix` |
| Fix review | `review-fix` | you (diff + test output) | approve → `needs: test` · reject → `needs: fix` with `feedback` |
| Test | `test` | tester | all green → `--status verify` (normal approval finishes it) · failure → back to `fix` or `reproduce` with `feedback` |

## The red-test rule

Nothing reaches `fix` without a failing test written first, and a fix that needs its
test rewritten to pass is not a fix -- it goes back to `reproduce` with `feedback`
saying why the test was wrong. This is the whole point of the split: the reproducer
may never fix, the fixer may never rewrite tests silently.

## Reject rules

- Default retry target is one stage back. A fix that keeps failing usually means the
  reproduction was wrong -- send it to `reproduce`, not around again.
- Every reject sets `feedback` to a short reason with evidence (failing output, not
  vibes).
- Every stage advance increments `attempts.<stage>`. Past 3 attempts on one stage, the
  task goes to `needs: stuck` instead of looping, for you to fix by hand.

## Pipeline fields

Stored in the task's `## Pipeline` block, written with `crew task update <id> --field
key=value` and read via `crew task show <id>`. An agent updates only its own stage's
output fields and `needs`; it never touches fields another stage owns.

| Field | Set by | Purpose |
| --- | --- | --- |
| `severity` | triager | `crash/data-loss`, `wrong-behavior`, or `cosmetic` |
| `area` | triager | Suspect area of the codebase |
| `test_cmd` | triager | The repo's suite command, quoted (asked, never guessed) |
| `repro-hint` | triager | Best lead on reproducing, or why there is none |
| `failing-test` | reproducer | Path plus test name of the red test |
| `files-changed` | fixer | What the fix touched, nothing more |
| `test-report` | tester | Suite plus checks outcome, all green |
| `feedback` | reviewer or any agent, on reject | What failed, with evidence |
| `attempts` | each agent, on finish | Per-stage counts, e.g. `attempts.fix: 2` |

## Adapter config

The repo's own commands are config, not code. `test_cmd` is recorded per task by the
triager; the tester passes it plus every acceptance `--check` to the verifier script:

| Stage | Script | Purpose |
| --- | --- | --- |
| Test | `tester/skills/scripts/verify-fix.py` | Runs `--test-cmd` plus repeatable `--check`, prints a JSON report, exit 1 unless all pass |

No secrets are needed for this pack.

---
vault_name: "{{VAULT_NAME}}"
api:
  port: 7717
  token: "{{TOKEN}}"
runners:
  claude:
    cmd: claude
    args: ["-p", "{{prompt}}", "--model", "{{model}}", "--output-format", "json", "--permission-mode", "bypassPermissions"]
    cost_from_json: true
  opencode:
    cmd: opencode
    args: ["run", "--model", "{{model}}", "{{prompt}}"]
  dryrun:
    cmd: "true"
    args: []
limits:
  max_sessions: 3
  max_jobs: 4
  claim_minutes: 30
  default_job_timeout: 15m
budget:
  crew_daily_usd: 20
locks: [gpu, blender, unity-editor]
external:
  ASSETS: "{{ASSETS}}"
project:
  repo: null
  worktrees: null
protected: [main-branch-config, released-builds, canon-lore]
verify:
  sample_rate: 0.1
  earn_after: 20
  earn_agreement: 0.95
  tiers:
    asset: auto
    docs: auto
    code: auto-second-opinion
    default: human
anomalies:
  enabled: true
  repeat_threshold: 2
---

# Crew settings

This file configures crew for this vault. crew reads the frontmatter above.

- **runners**: how each agent runner is launched. `{{prompt}}` and `{{model}}` are filled per session. `dryrun` does nothing and is useful for testing.
- **limits**: how many agent sessions and jobs run at once, how long an agent claim lasts without renewal (`claim_minutes`), and how long a job can run before crew kills it and wakes the agent with `job.timeout` (`default_job_timeout`) when `crew job run` isn't given its own `--timeout`. An agent's own `jobs.default_timeout` in its `agent.md` (e.g. for one that always runs long renders) wins over this vault-wide default.
- **locks**: shared resources a job can hold one at a time.
- **external**: named folders outside the vault, used as `${NAME}` in tasks and agent paths.
- **project.repo**: a git repo for code tasks. When set, code tasks get a git worktree on branch `crew/<task>`. `project.worktrees` sets where work trees live (default: a folder next to the vault).
- **protected**: task tags that always go to the human for approval.
- **verify.tiers**: the most a task type can unlock. `human` never auto-approves. `auto` auto-approves once earned. `auto-second-opinion` also needs two different agents to approve. A type earns auto-approval after `earn_after` human reviews with at least `earn_agreement` agreement with the verifier.
- **anomalies**: crew watches for repeated job failures, expiring claims and budget stops, and emits `crew.anomaly` for the watcher agent.

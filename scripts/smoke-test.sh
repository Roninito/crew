#!/usr/bin/env bash
# End-to-end smoke test in a throwaway vault. Uses the "dryrun" runner, so no AI calls are made.
# Usage: scripts/smoke-test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$ROOT/packages/crew" && bun run gen-helpers && bun run gen-vault-template) >/dev/null
TMP="$(mktemp -d)"
VAULT="$TMP/TestVault"
export CREW_VAULT="$VAULT"
CREW=(bun "$ROOT/packages/crew/bin/crew.ts")
PORT=$(( 17000 + RANDOM % 1000 ))
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }
cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP" 2>/dev/null || true
}
trap cleanup EXIT

"$ROOT/scripts/init-vault.sh" "$VAULT" >/dev/null
tmp="$(mktemp)"; sed "s/port: 7717/port: $PORT/" "$VAULT/crew/crew.md" > "$tmp" && mv "$tmp" "$VAULT/crew/crew.md"
TOKEN="$(sed -n 's/^  token: "\(.*\)"/\1/p' "$VAULT/crew/crew.md")"
[ -n "$TOKEN" ] && pass "vault initialized with token" || fail "token missing"

"${CREW[@]}" status >/dev/null && pass "status"

# Built-in agents ship pre-filled (no {{BLANK: ...}} markers) and lint clean out of the box --
# verifier enabled, planner/scout/devops/watcher disabled. A blank or a bad frontmatter field in
# any of these would otherwise go unnoticed until a real vault hit it.
for BUILTIN in verifier planner scout devops watcher; do
  "${CREW[@]}" agent lint "$BUILTIN" >/dev/null && pass "built-in agent $BUILTIN lints clean" || fail "built-in agent $BUILTIN fails lint"
done
grep -q "^enabled: true$" "$VAULT/crew/agents/verifier/agent.md" && pass "verifier ships enabled" || fail "verifier should ship enabled"
for BUILTIN in planner scout devops watcher; do
  grep -q "^enabled: false$" "$VAULT/crew/agents/$BUILTIN/agent.md" && pass "$BUILTIN ships disabled" || fail "$BUILTIN should ship disabled"
done
grep -q "task.blocked" "$VAULT/crew/agents/watcher/agent.md" && pass "watcher subscribes to task.blocked" || fail "watcher should subscribe to task.blocked"

# Agent name validation: distinct, non-misleading errors for missing vs. malformed names -- the
# old message hardcoded "--runner claude --model sonnet" as its usage example regardless of what
# the user actually chose, which read as "your runner got reverted to claude" when the real
# problem was the name (e.g. a capital letter).
"${CREW[@]}" agent new >/dev/null 2>&1 && fail "agent new should require a name" || pass "missing name gives a usage error"
if OUT="$("${CREW[@]}" agent new Bad_Name --template worker --runner dryrun --model none --can demo 2>&1)"; then
  fail "agent new should reject a capitalized/underscored name"
else
  echo "$OUT" | grep -q "Bad_Name" && ! echo "$OUT" | grep -q "runner claude" && pass "malformed name error names the bad value, not an unrelated runner/model example" || fail "malformed-name error text: $OUT"
fi

# Agent scaffolding: lint must fail on blanks, pass once filled.
"${CREW[@]}" agent new tester --template worker --runner dryrun --model none --can demo >/dev/null
if "${CREW[@]}" agent lint tester >/dev/null; then fail "lint should fail with blanks"; else pass "lint catches blanks"; fi
A="$VAULT/crew/agents/tester/agent.md"
perl -0pi -e 's/\{\{BLANK:.*?\}\}/filled/gs' "$A"
"${CREW[@]}" agent lint tester >/dev/null && pass "lint passes after filling"
"${CREW[@]}" agent enable tester >/dev/null && pass "agent enabled"

# Agent set: changes only the fields given, in place, without disturbing anything else in the file.
"${CREW[@]}" agent set tester --runner opencode --model "opencode/claude-sonnet-5" >/dev/null
grep -q "^runner: opencode$" "$A" && grep -q "^model: opencode/claude-sonnet-5$" "$A" && pass "agent set updates runner and model" || fail "agent set didn't update runner/model"
grep -q "^enabled: true$" "$A" && grep -q "^can: \[demo\]$" "$A" && pass "agent set leaves the rest of the file untouched" || fail "agent set disturbed unrelated fields"
"${CREW[@]}" agent set tester >/dev/null 2>&1 && fail "agent set with nothing to change should error" || pass "agent set refuses a no-op call"
# Revert: later checks wake tester for real sessions and need the free, always-available dryrun
# runner -- opencode won't be installed on CI, and a session launch would silently emit nothing
# (agent.error only, no session.started) rather than fail loudly, so this would misreport as
# "no wake" far below instead of pointing at its actual cause here.
"${CREW[@]}" agent set tester --runner dryrun --model none >/dev/null

# Agent removal: refused while enabled, deletes the folder once disabled.
"${CREW[@]}" agent new scratch --template worker --runner dryrun --model none --can demo >/dev/null
perl -0pi -e 's/\{\{BLANK:.*?\}\}/filled/gs' "$VAULT/crew/agents/scratch/agent.md"
"${CREW[@]}" agent enable scratch >/dev/null
if "${CREW[@]}" agent remove scratch >/dev/null 2>&1; then fail "remove should refuse an enabled agent"; else pass "remove refuses an enabled agent"; fi
"${CREW[@]}" agent disable scratch >/dev/null
"${CREW[@]}" agent remove scratch >/dev/null && pass "remove deletes a disabled agent"
[ ! -d "$VAULT/crew/agents/scratch" ] && pass "removed agent's folder is gone" || fail "scratch folder still exists"
"${CREW[@]}" agent lint scratch >/dev/null 2>&1 && fail "lint should fail for a removed agent" || pass "removed agent no longer resolves"

# Task lifecycle with a Python job.
"${CREW[@]}" task new "Inbox task" >/dev/null
"${CREW[@]}" task list --status inbox | grep -q T-0001 && pass "task without criteria stays in inbox"
"${CREW[@]}" task new "Demo asset" --needs demo --type asset --accept "hello.txt is produced" --check "true" >/dev/null
"${CREW[@]}" claim T-0002 --as tester >/dev/null && pass "agent claimed task"
"${CREW[@]}" job run --as tester --task T-0002 --script "$VAULT/crew/templates/scripts/example-job.py" --timeout 1m >/dev/null
for i in $(seq 1 40); do
  S="$("${CREW[@]}" jobs --json | grep -o '"status": "[a-z]*"' | head -1 | cut -d'"' -f4)"
  [ "$S" = "succeeded" ] && break
  [ "$S" = "failed" ] && { cat "$VAULT/crew/jobs/J-0001/run.log"; fail "python job failed"; }
  sleep 0.5
done
[ "$S" = "succeeded" ] && pass "python job succeeded" || fail "python job status: $S"
"${CREW[@]}" events --since 5m | grep -q "job.progress" && pass "job progress events emitted"
grep -q "hello.txt" "$VAULT/crew/events/"*.jsonl && pass "job.succeeded lists produced files"

# Bun job and a failing job.
"${CREW[@]}" job run --as tester --task T-0002 --script "$VAULT/crew/templates/scripts/example-job.ts" --timeout 1m >/dev/null
printf 'import sys\nsys.exit(3)\n' > "$TMP/fail.py"
"${CREW[@]}" job run --as tester --task T-0002 --script "$TMP/fail.py" --timeout 1m >/dev/null
sleep 6
"${CREW[@]}" jobs | grep J-0002 | grep -q succeeded && pass "bun job succeeded" || { cat "$VAULT/crew/jobs/J-0002/run.log"; fail "bun job"; }
"${CREW[@]}" jobs | grep J-0003 | grep -q failed && pass "failing script still emits job.failed"

# Verification and trust policy.
"${CREW[@]}" audit T-0002 >/dev/null && pass "audit runs checks"
"${CREW[@]}" task update T-0002 --status verify --as tester --note "done" >/dev/null
if "${CREW[@]}" verdict T-0002 approve --as tester >/dev/null 2>&1; then fail "self-approval allowed"; else pass "agents can't approve their own work"; fi
"${CREW[@]}" verdict T-0002 approve --as verifier --reason "file present" | grep -q escalated && pass "unearned type escalates to human"
"${CREW[@]}" verdict T-0002 approve >/dev/null && "${CREW[@]}" task list --status done | grep -q T-0002 && pass "human approval completes task"
"${CREW[@]}" trace T-0002 >/dev/null && grep -q "job.succeeded" "$VAULT/crew/traces/T-0002.md" && pass "trace written"

# A non-code task's --target names one file, not the whole staging folder: claiming it must seed
# the work tree with a copy of whatever's already there (so an append-only file can be read and
# preserved, not silently started from nothing), and approval must copy that one file back --
# never the whole work tree onto it, which turns a file target into a directory.
printf '## existing entry\nkeep me\n' > "$VAULT/Blog.md"
"${CREW[@]}" task new "blog update" --needs demo --type docs --target Blog.md --accept "x" --check "true" >/dev/null
"${CREW[@]}" claim T-0003 --as tester >/dev/null
WT3="$("${CREW[@]}" task show T-0003 --json | grep -o '"worktree": "[^"]*"' | cut -d'"' -f4)"
grep -q "keep me" "$WT3/Blog.md" && pass "claiming seeds the work tree with the existing target file" || fail "work tree wasn't seeded with Blog.md"
printf '\n## new entry\nadded by tester\n' >> "$WT3/Blog.md"
"${CREW[@]}" task update T-0003 --status verify --as tester --note "done" >/dev/null
"${CREW[@]}" verdict T-0003 approve >/dev/null
[ -f "$VAULT/Blog.md" ] && [ ! -d "$VAULT/Blog.md" ] && pass "approval copies the target file back as a file, not a directory" || fail "Blog.md is a directory after approval"
grep -q "keep me" "$VAULT/Blog.md" && grep -q "added by tester" "$VAULT/Blog.md" && pass "approval preserves prior content and adds the new entry" || fail "Blog.md is missing prior or new content"

# Some agents write straight to the live target instead of the staging copy (a singleton file,
# by the agent's own design) -- the work tree then has no target file at all, and approval must
# recognize "already at the real location" as success, not a missing-file error.
"${CREW[@]}" task new "direct write" --needs demo --type docs --target Direct.md --accept "x" --check "true" >/dev/null
"${CREW[@]}" claim T-0004 --as tester >/dev/null
echo "written straight to the vault, not the work tree" > "$VAULT/Direct.md"
"${CREW[@]}" task update T-0004 --status verify --as tester --note "done" >/dev/null
"${CREW[@]}" verdict T-0004 approve >/dev/null && "${CREW[@]}" task list --status done | grep -q T-0004 && pass "approval succeeds when the worker wrote the target directly" || fail "approval of a directly-written target failed"
grep -q "written straight to the vault" "$VAULT/Direct.md" && pass "directly-written target is untouched by approval" || fail "Direct.md content changed or vanished"

# Server: API, auth, and event-driven wakes.
bun "$ROOT/packages/crew/bin/crew.ts" serve >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && pass "server health"
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/status")" = "401" ] && pass "API requires token"
curl -sf -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/status" | grep -q '"agents"' && pass "API status"
curl -sf -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"argv":["task","new","Wake test","--needs","demo","--accept","x"],"as":"human"}' "http://127.0.0.1:$PORT/cmd" | grep -q '"code":0' && pass "API command"
for i in $(seq 1 20); do grep -q '"session.ended".*"tester"' "$VAULT/crew/events/"*.jsonl && break; sleep 0.5; done
grep -q '"session.started"' "$VAULT/crew/events/"*.jsonl && pass "task.ready woke the subscribed agent" || { cat "$TMP/server.log"; fail "no wake"; }

# Questions: an agent asks, the human answers, and only the asking agent wakes for it.
tmp="$(mktemp)"; sed 's/subscribes: \[task.ready, job.succeeded, job.failed, job.timeout, review.rejected\]/subscribes: [task.ready, job.succeeded, job.failed, job.timeout, review.rejected, question.answered]/' "$VAULT/crew/agents/tester/agent.md" > "$tmp" && mv "$tmp" "$VAULT/crew/agents/tester/agent.md"
"${CREW[@]}" question new >/dev/null 2>&1 && fail "question new should require topic and --text" || pass "question new without --text errors"
QID="$("${CREW[@]}" question new "Blender or Houdini" --text "1. which do you prefer\n2. why" --as tester --json | grep -o '"id": "Q-[0-9]*"' | head -1 | cut -d'"' -f4)"
[ -n "$QID" ] && pass "question new created $QID" || fail "question new didn't return an id"
"${CREW[@]}" question list --status open | grep -q "$QID" && pass "question shows up as open" || fail "question not listed as open"
BEFORE_WAKES=$(grep -o '"session.started"' "$VAULT/crew/events/"*.jsonl | wc -l | tr -d ' ')
"${CREW[@]}" question answer "$QID" "Blender, it's what the pipeline already uses" >/dev/null && pass "question answered"
"${CREW[@]}" question list --status answered | grep -q "$QID" && pass "answered question moves out of the open list" || fail "question still shows open after answering"
"${CREW[@]}" question answer "$QID" "a second answer" >/dev/null 2>&1 && fail "answering twice should be refused" || pass "answering an already-answered question is refused"
for i in $(seq 1 20); do
  AFTER_WAKES=$(grep -o '"session.started"' "$VAULT/crew/events/"*.jsonl | wc -l | tr -d ' ')
  [ "$AFTER_WAKES" -gt "$BEFORE_WAKES" ] && break
  sleep 0.5
done
[ "$AFTER_WAKES" -gt "$BEFORE_WAKES" ] && pass "answering the question woke the asking agent" || { cat "$TMP/server.log"; fail "no wake after answering"; }

# Job timeout resolution: --timeout wins, then the agent's own jobs.default_timeout, then crew.md's default.
tmp="$(mktemp)"; sed 's/default_timeout: 15m/default_timeout: 7m/' "$VAULT/crew/agents/tester/agent.md" > "$tmp" && mv "$tmp" "$VAULT/crew/agents/tester/agent.md"
"${CREW[@]}" job run --as tester --task T-0002 --script "$VAULT/crew/templates/scripts/example-job.py" >/dev/null
"${CREW[@]}" jobs --json | grep -q '"timeout": "7m"' && pass "job timeout falls back to the agent's own jobs.default_timeout" || fail "agent-level default_timeout not honored"
"${CREW[@]}" job run --as tester --task T-0002 --script "$VAULT/crew/templates/scripts/example-job.py" --timeout 2m >/dev/null
"${CREW[@]}" jobs --json | grep -q '"timeout": "2m"' && pass "explicit --timeout still wins over the agent default" || fail "--timeout was overridden"

# Per-agent job concurrency cap: tester's worker template sets jobs.max_concurrent: 1, so of two
# jobs queued back to back, only one should be running at a time even though crew.md's global
# limits.max_jobs (4) would otherwise let both run at once.
"${CREW[@]}" job run --as tester --task T-0002 --script "$VAULT/crew/templates/scripts/example-job.py" >/dev/null
"${CREW[@]}" job run --as tester --task T-0002 --script "$VAULT/crew/templates/scripts/example-job.py" >/dev/null
n=0
for i in $(seq 1 20); do
  n="$("${CREW[@]}" jobs | grep tester | grep -c running || true)"
  [ "$n" -ge 1 ] && break
  sleep 0.25
done
[ "$n" = "1" ] && pass "agent's jobs.max_concurrent caps concurrent jobs for that agent" || fail "expected exactly 1 running tester job, got $n"
n2=0
for i in $(seq 1 40); do
  n2="$("${CREW[@]}" jobs | grep tester | grep -c succeeded || true)"
  [ "$n2" -ge 2 ] && break
  sleep 0.5
done
[ "$n2" -ge 2 ] && pass "both capped jobs eventually ran to completion" || fail "expected both tester jobs to succeed, got $n2 succeeded"

# Kill switch.
"${CREW[@]}" stop --all >/dev/null && "${CREW[@]}" status | grep -q PAUSED && pass "kill switch pauses the crew"
"${CREW[@]}" resume >/dev/null && pass "resume"

# Compiled-binary self-respawn check. `crew wake` and `crew job run` both re-invoke the running
# binary as a detached child (crew session / crew job exec). A `bun build --compile` binary gets a
# different argv shape than `bun bin/crew.ts` -- Bun injects its own ["bun", "<virtual bunfs
# path>"] pair ahead of real args -- and this silently broke both paths once already: passing an
# extra leading argument shifted every real argument over by one, so the subcommand was never
# dispatched, with no error anywhere (these run detached with stdio ignored). Every check above
# uses `bun bin/crew.ts` directly and would never catch that regression, since dev mode doesn't
# have this argv shape at all.
kill "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""
sleep 0.3
COMPILED="$TMP/crew-compiled"
(cd "$ROOT/packages/crew" && bun build --compile ./bin/crew.ts --outfile "$COMPILED") >/dev/null 2>&1
"$COMPILED" serve >"$TMP/compiled-server.log" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && pass "compiled binary: server starts and serves /health"

"$COMPILED" wake tester --reason "compiled-wake-check" >/dev/null
for i in $(seq 1 20); do grep -q "compiled-wake-check" "$VAULT/crew/events/"*.jsonl && break; sleep 0.25; done
grep -q '"session.started".*compiled-wake-check' "$VAULT/crew/events/"*.jsonl \
  && pass "compiled binary: crew wake actually dispatches a session" \
  || { cat "$TMP/compiled-server.log"; fail "compiled binary: wake produced no session -- the exact self-respawn regression this guards"; }

JOUT="$("$COMPILED" job run --as tester --task T-0002 --script "$VAULT/crew/templates/scripts/example-job.py" --timeout 1m)"
JID="$(echo "$JOUT" | grep -o 'J-[0-9]*' | head -1)"
for i in $(seq 1 40); do "$COMPILED" jobs | grep "$JID" | grep -q "succeeded\|failed" && break; sleep 0.5; done
"$COMPILED" jobs | grep "$JID" | grep -q succeeded \
  && pass "compiled binary: crew job run actually dispatches and completes" \
  || { cat "$TMP/compiled-server.log"; echo "--- $JID run.log ---"; cat "$VAULT/crew/jobs/$JID/run.log" 2>&1; fail "compiled binary: $JID didn't succeed -- the exact self-respawn regression this guards, or see run.log above"; }

# --- Phase 1: the machine service (crew serve with no --vault), many projects behind one port ---
# A separate CREW_HOME so this can never touch a real machine home, and CREW_VAULT unset so
# --project resolution (not the leftover single-vault env var) is what actually gets exercised.
kill "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""
unset CREW_VAULT
MHOME="$TMP/home"
export CREW_HOME="$MHOME"
PROJ_A="$TMP/ProjectA"
PROJ_B="$TMP/ProjectB"
MPORT=$(( 18000 + RANDOM % 1000 ))

"${CREW[@]}" init "$PROJ_A" --id proja >/dev/null && pass "crew init scaffolds and registers a project"
"${CREW[@]}" init "$PROJ_B" --id projb >/dev/null && pass "crew init scaffolds and registers a second project"
"${CREW[@]}" projects | grep -qE '^proja\s+active' && "${CREW[@]}" projects | grep -qE '^projb\s+active' && pass "crew projects lists both" || fail "crew projects didn't list both proja and projb"

mkdir -p "$TMP/PlainFolder"
"${CREW[@]}" init "$TMP/PlainFolder" --id plainf >/dev/null
"${CREW[@]}" projects | grep -qE '^plainf\s+active\s+folder\b' && pass "crew init detects kind \"folder\" for a plain directory" || fail "kind detection: folder"
mkdir -p "$TMP/GitRepo" && (cd "$TMP/GitRepo" && git init -q)
"${CREW[@]}" init "$TMP/GitRepo" --id gitrepo >/dev/null
"${CREW[@]}" projects | grep -qE '^gitrepo\s+active\s+repo\b' && pass "crew init detects kind \"repo\" for a .git folder" || fail "kind detection: repo"

# One dryrun-runnered worker per project, matching the top-level tests' own pattern.
for P in proja:$PROJ_A projb:$PROJ_B; do
  ID="${P%%:*}"; DIR="${P##*:}"
  "${CREW[@]}" agent new tester --template worker --runner dryrun --model none --can demo --project "$ID" >/dev/null
  perl -0pi -e 's/\{\{BLANK:.*?\}\}/filled/gs' "$DIR/crew/agents/tester/agent.md"
  "${CREW[@]}" agent enable tester --project "$ID" >/dev/null
  "${CREW[@]}" task new "task for $ID" --needs demo --type asset --accept "ok" --check "true" --project "$ID" >/dev/null
done

# Qualified ids: a human can reference another registered project's item directly, without
# --project -- no machine service needs to be running for this, it's pure local CLI resolution.
"${CREW[@]}" task show proja:T-0001 2>/dev/null | grep -q "task for proja" \
  && pass "qualified id (proja:T-0001) resolves to the right project" \
  || fail "qualified id resolution didn't find proja's task"
"${CREW[@]}" task show projb:T-0001 2>/dev/null | grep -q "task for projb" \
  && pass "qualified id (projb:T-0001) resolves to a different project" \
  || fail "qualified id resolution didn't find projb's task"
"${CREW[@]}" task new "release: v2 notes" --needs demo --type asset --accept "ok" --check "true" --project proja >/dev/null
"${CREW[@]}" task list --status ready --project proja | grep -q "release: v2 notes" \
  && pass "a colon that doesn't match a registered project id is left alone, not misparsed as a qualified id" \
  || fail "title with an unrelated colon got mangled by qualified-id parsing"

tmp="$(mktemp)"; sed "s/port: 7717/port: $MPORT/" "$MHOME/crew.md" > "$tmp" && mv "$tmp" "$MHOME/crew.md"
MTOKEN="$(sed -n 's/^  token: "\(.*\)"/\1/p' "$MHOME/crew.md")"

bun "$ROOT/packages/crew/bin/crew.ts" serve >"$TMP/machine-server.log" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$MPORT/health" >/dev/null && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$MPORT/health" >/dev/null && pass "machine service: health"
curl -sf -H "Authorization: Bearer $MTOKEN" "http://127.0.0.1:$MPORT/projects" | grep -q '"id":"proja"' \
  && curl -sf -H "Authorization: Bearer $MTOKEN" "http://127.0.0.1:$MPORT/projects" | grep -q '"id":"projb"' \
  && pass "machine service: /projects lists both over HTTP" || fail "/projects missing a project"

for i in $(seq 1 20); do
  grep -q '"session.started"' "$PROJ_A/crew/events/"*.jsonl 2>/dev/null && grep -q '"session.started"' "$PROJ_B/crew/events/"*.jsonl 2>/dev/null && break
  sleep 0.25
done
grep -q '"session.started"' "$PROJ_A/crew/events/"*.jsonl 2>/dev/null && grep -q '"session.started"' "$PROJ_B/crew/events/"*.jsonl 2>/dev/null \
  && pass "one service dispatches agents in two projects at once, on one port" \
  || { cat "$TMP/machine-server.log"; fail "expected session.started in both projects' event logs"; }

# Restart-resume: a job that finishes while the service is down must still wake its agent once
# the service comes back, via the persisted offset -- not silently missed by re-seeding at EOF.
BEFORE="$(grep -c '"session.started"' "$PROJ_A/crew/events/"*.jsonl 2>/dev/null || echo 0)"
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""
sleep 0.3
[ ! -f "$MHOME/.state/pid.json" ] && pass "machine service removes its pid file on shutdown" || fail "pid.json still present after shutdown"

"${CREW[@]}" job run --as tester --script "$PROJ_A/crew/templates/scripts/example-job.py" --timeout 1m --project proja >/dev/null
for i in $(seq 1 40); do
  S="$("${CREW[@]}" jobs --project proja --json | grep -o '"status": "[a-z]*"' | head -1 | cut -d'"' -f4)"
  [ "$S" = "succeeded" ] && break
  sleep 0.5
done
[ "$S" = "succeeded" ] && pass "a job queued while the machine service is down still completes" || fail "job in project proja never succeeded (status: $S)"

bun "$ROOT/packages/crew/bin/crew.ts" serve >"$TMP/machine-server-2.log" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$MPORT/health" >/dev/null && break; sleep 0.25; done
AFTER=0
for i in $(seq 1 20); do
  AFTER="$(grep -c '"session.started"' "$PROJ_A/crew/events/"*.jsonl 2>/dev/null || echo 0)"
  [ "$AFTER" -gt "$BEFORE" ] && break
  sleep 0.5
done
[ "$AFTER" -gt "$BEFORE" ] && pass "restart resumes from the persisted offset -- the agent wakes for what it missed" \
  || { cat "$TMP/machine-server-2.log"; fail "no new session.started in project a after restart (before=$BEFORE after=$AFTER)"; }

# --- crew migrate: bring an existing v0 vault into the registry (machine service still running) ---
LEGACY="$TMP/LegacyVault"
"$ROOT/scripts/init-vault.sh" "$LEGACY" >/dev/null
LPORT=$(( 19000 + RANDOM % 1000 ))
tmp="$(mktemp)"; sed "s/port: 7717/port: $LPORT/" "$LEGACY/crew/crew.md" > "$tmp" && mv "$tmp" "$LEGACY/crew/crew.md"

# A real, currently-running v0 server for it -- this is exactly the case migrate has to take over from.
CREW_VAULT="$LEGACY" bun "$ROOT/packages/crew/bin/crew.ts" serve >"$TMP/legacy-server.log" 2>&1 &
LEGACY_PID=$!
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$LPORT/health" >/dev/null && break; sleep 0.25; done
curl -sf "http://127.0.0.1:$LPORT/health" >/dev/null && pass "legacy vault has its own v0 server running, pre-migrate"

# A scripts/service.sh install for it: only the unit *file* is created (not actually loaded into
# launchd/systemd), which is enough to prove migrate finds and removes it by the same name that
# script uses, without registering a real background daemon on this machine.
LNAME="crew-$(basename "$LEGACY" | tr -c 'a-zA-Z0-9\n' '-')"
if [ "$(uname)" = "Darwin" ]; then UNIT_FILE="$HOME/Library/LaunchAgents/com.crew.$LNAME.plist"
else UNIT_FILE="$HOME/.config/systemd/user/$LNAME.service"; fi
mkdir -p "$(dirname "$UNIT_FILE")"
echo placeholder > "$UNIT_FILE"

bun "$ROOT/packages/crew/bin/crew.ts" migrate "$LEGACY" >"$TMP/migrate.log" 2>&1 || { cat "$TMP/migrate.log"; fail "crew migrate exited non-zero"; }
sleep 0.3
[ ! -f "$LEGACY/crew/.state/server.json" ] && pass "migrate stopped the legacy vault's own running server" || fail "legacy server.json still present after migrate"
wait "$LEGACY_PID" 2>/dev/null || true
[ ! -f "$UNIT_FILE" ] && pass "migrate removed the scripts/service.sh unit file" || fail "unit file still present after migrate"
! grep -qE '^\s+port:' "$LEGACY/crew/crew.md" && pass "migrate drops api.port from crew.md" || fail "port: line still present after migrate"
grep -q 'token:' "$LEGACY/crew/crew.md" && pass "migrate keeps the vault's own token" || fail "token missing after migrate"

for i in $(seq 1 20); do "${CREW[@]}" projects | grep -qE '^legacyvault\s+active' && break; sleep 0.25; done
"${CREW[@]}" projects | grep -qE '^legacyvault\s+active' && pass "migrated vault appears in the registry, active" || fail "legacyvault not registered active"
curl -sf -H "Authorization: Bearer $MTOKEN" "http://127.0.0.1:$MPORT/projects" | grep -q '"id":"legacyvault"' \
  && pass "the already-running machine service picked it up with no restart" || fail "machine service /projects missing legacyvault"

bun "$ROOT/packages/crew/bin/crew.ts" migrate "$LEGACY" >/dev/null 2>&1 && pass "migrate is safe to re-run (no-op the second time)"

bun "$ROOT/packages/crew/bin/crew.ts" serve --vault "$LEGACY" >"$TMP/guard-check.log" 2>&1 &
GUARD_PID=$!
sleep 1.5
kill "$GUARD_PID" 2>/dev/null || true
wait "$GUARD_PID" 2>/dev/null || true
if grep -q "registered with the machine service" "$TMP/guard-check.log"; then
  pass "serve --vault refuses a path already registered+active in the machine service"
else
  cat "$TMP/guard-check.log"
  fail "serve --vault should have refused an already-registered active project"
fi

echo "All smoke tests passed."

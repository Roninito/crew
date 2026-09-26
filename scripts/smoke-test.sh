#!/usr/bin/env bash
# End-to-end smoke test in a throwaway vault. Uses the "dryrun" runner, so no AI calls are made.
# Usage: scripts/smoke-test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
VAULT="$TMP/TestVault"
export CREW_VAULT="$VAULT"
CREW=(bun "$ROOT/packages/crew/bin/crew.ts")
PORT=$(( 17000 + RANDOM % 1000 ))
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }
cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

"$ROOT/scripts/init-vault.sh" "$VAULT" >/dev/null
tmp="$(mktemp)"; sed "s/port: 7717/port: $PORT/" "$VAULT/crew/crew.md" > "$tmp" && mv "$tmp" "$VAULT/crew/crew.md"
TOKEN="$(sed -n 's/^  token: "\(.*\)"/\1/p' "$VAULT/crew/crew.md")"
[ -n "$TOKEN" ] && pass "vault initialized with token" || fail "token missing"

"${CREW[@]}" status >/dev/null && pass "status"

# Agent scaffolding: lint must fail on blanks, pass once filled.
"${CREW[@]}" agent new tester --template worker --runner dryrun --model none --can demo >/dev/null
if "${CREW[@]}" agent lint tester >/dev/null; then fail "lint should fail with blanks"; else pass "lint catches blanks"; fi
A="$VAULT/crew/agents/tester/agent.md"
perl -0pi -e 's/\{\{BLANK:.*?\}\}/filled/gs' "$A"
"${CREW[@]}" agent lint tester >/dev/null && pass "lint passes after filling"
"${CREW[@]}" agent enable tester >/dev/null && pass "agent enabled"

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

# Kill switch.
"${CREW[@]}" stop --all >/dev/null && "${CREW[@]}" status | grep -q PAUSED && pass "kill switch pauses the crew"
"${CREW[@]}" resume >/dev/null && pass "resume"

echo "All smoke tests passed."

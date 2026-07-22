#!/usr/bin/env bash
# Phase 2 — Smart Agent Test Suite
# Usage: bash phase2/test-phase2.sh [--no-rebuild]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/docker"
API="http://localhost:3000"
REBUILD=true
LOG_FILE="$SCRIPT_DIR/test-phase2.log"

for arg in "$@"; do
  case $arg in --no-rebuild) REBUILD=false ;; esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
PASS=0; FAIL=0

log()   { echo -e "$*" | tee -a "$LOG_FILE"; }
debug() { echo -e "    ${CYAN}↳ $*${RESET}" | tee -a "$LOG_FILE"; }
pass()  { PASS=$((PASS+1)); log "${GREEN}  ✓ PASS${RESET}  $1"; }
fail()  { FAIL=$((FAIL+1)); log "${RED}  ✗ FAIL${RESET}  $1${2:+  (debug: $2)}"; }
section() { log ""; log "${BOLD}${CYAN}━━━ $1 ━━━${RESET}"; }

http_json() {
  local method="$1" url="$2"; shift 2
  curl -s -o /tmp/ph2_body.json -w "%{http_code}" -X "$method" "$url" \
    -H "Content-Type: application/json" "$@" 2>>/tmp/ph2_curl_err.txt
}
body() { cat /tmp/ph2_body.json 2>/dev/null || echo '{}'; }

> "$LOG_FILE"
log ""
log "${BOLD}╔══════════════════════════════════════════╗${RESET}"
log "${BOLD}║   AgentTelar — Phase 2 Test Suite        ║${RESET}"
log "${BOLD}╚══════════════════════════════════════════╝${RESET}"
log "  Log: $LOG_FILE | API: $API | Rebuild: $REBUILD"

# ─── Prerequisites ────────────────────────────────────────────────────────────
section "Prerequisites"
command -v docker &>/dev/null && pass "docker installed" || { fail "docker not found"; exit 1; }
command -v jq    &>/dev/null && pass "jq installed"     || { fail "jq not found — brew install jq"; exit 1; }

# ─── Docker ───────────────────────────────────────────────────────────────────
section "Docker Stack (API + Redis + PostgreSQL)"
cd "$COMPOSE_DIR"
if [[ "$REBUILD" == "true" ]]; then
  docker compose up --build -d 2>>"$LOG_FILE" && pass "docker compose up --build" \
    || { fail "docker compose up failed"; docker compose logs 2>&1 | tail -30 | tee -a "$LOG_FILE"; exit 1; }
else
  docker compose up -d 2>>"$LOG_FILE" && pass "docker compose up"
fi

log "  Waiting for API to become healthy..."
MAX_WAIT=90; WAITED=0
until curl -sf "$API/health" >/dev/null 2>&1; do
  sleep 3; WAITED=$((WAITED+3))
  [[ $WAITED -ge $MAX_WAIT ]] && {
    fail "API not healthy after ${MAX_WAIT}s"
    docker compose logs api 2>&1 | tail -30 | tee -a "$LOG_FILE"
    exit 1
  }
done
PHASE=$(curl -s "$API/health" | jq -r '.phase // empty')
pass "API healthy (phase=$PHASE)"
[[ "$PHASE" == "2" ]] || fail "Expected phase=2, got phase=$PHASE"

# Verify Redis is healthy
REDIS_STATUS=$(docker compose exec -T redis redis-cli ping 2>/dev/null | tr -d '[:space:]')
[[ "$REDIS_STATUS" == "PONG" ]] && pass "Redis is healthy (PONG)" || fail "Redis ping failed (got: $REDIS_STATUS)"

# Verify PostgreSQL is healthy
PG_STATUS=$(docker compose exec -T postgres pg_isready -U agenttelar 2>/dev/null | grep -c 'accepting' || echo "0")
[[ "$PG_STATUS" -ge 1 ]] && pass "PostgreSQL is healthy" || fail "PostgreSQL not ready"

# ─── Check 1: Tool use — weather ─────────────────────────────────────────────
section "Check 1 — Agent uses tools (tool_call + tool_result events in SSE stream)"

SSE_WEATHER=$(curl -s -N -X POST "$API/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"What is the weather in Tokyo right now?"}' \
  --max-time 45 2>/dev/null || true)

debug "SSE events received: $(echo "$SSE_WEATHER" | grep '^event:' | tr '\n' ' ')"

if echo "$SSE_WEATHER" | grep -q 'event: tool_call'; then
  TOOL=$(echo "$SSE_WEATHER" | grep '"tool"' | head -1 | grep -o '"tool":"[^"]*"' | head -1)
  pass "tool_call event present ($TOOL)"
else
  fail "No tool_call event — agent did not use a tool for weather query"
fi

if echo "$SSE_WEATHER" | grep -q 'event: tool_result'; then
  pass "tool_result event present"
else
  fail "No tool_result event"
fi

if echo "$SSE_WEATHER" | grep -q 'event: done'; then
  pass "SSE done event present"
else
  fail "No done event in response"
fi

# ─── Check 2: Calculator tool ─────────────────────────────────────────────────
section "Check 2 — Calculator tool works"

SSE_CALC=$(curl -s -N -X POST "$API/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"Calculate 25% of 4500"}' \
  --max-time 45 2>/dev/null || true)

debug "Calc SSE events: $(echo "$SSE_CALC" | grep '^event:' | tr '\n' ' ')"

if echo "$SSE_CALC" | grep -q 'event: tool_call'; then
  pass "Calculator tool_call event seen"
else
  fail "Calculator tool_call not triggered"
fi

# Check the final answer contains 1125 (25% of 4500)
FULL_RESP=$(echo "$SSE_CALC" | grep '"content"' | tail -3 | tr -d '\n')
if echo "$FULL_RESP" | grep -q '1125'; then
  pass "Calculator result contains correct value (1125)"
else
  fail "Correct value 1125 not found in response" "${FULL_RESP:0:200}"
fi

# ─── Check 3: Session memory persists ────────────────────────────────────────
section "Check 3 — Session memory persists across turns"

SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
debug "Using session: $SESSION_ID"

# Turn 1: introduce a name
SSE_T1=$(curl -s -N -X POST "$API/api/chat" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"My name is TestUser_Phase2\",\"sessionId\":\"$SESSION_ID\"}" \
  --max-time 30 2>/dev/null || true)
echo "$SSE_T1" | grep -q 'event: done' && pass "Turn 1 completed" || fail "Turn 1 no done event"

# Turn 2: recall the name
SSE_T2=$(curl -s -N -X POST "$API/api/chat" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"What is my name?\",\"sessionId\":\"$SESSION_ID\"}" \
  --max-time 30 2>/dev/null || true)

RESP_TEXT=$(echo "$SSE_T2" | grep '"content"' | grep -v 'null' | tail -5 | tr -d '\n')
if echo "$RESP_TEXT" | grep -qi 'TestUser_Phase2'; then
  pass "Agent recalled name from previous turn (memory works)"
else
  fail "Agent did not recall 'TestUser_Phase2' — memory may not be persisting" "${RESP_TEXT:0:300}"
fi

# ─── Check 4: New session = no memory ────────────────────────────────────────
section "Check 4 — New session has no memory of previous session"

NEW_SESSION=$(uuidgen | tr '[:upper:]' '[:lower:]')
SSE_NEW=$(curl -s -N -X POST "$API/api/chat" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"What is my name?\",\"sessionId\":\"$NEW_SESSION\"}" \
  --max-time 30 2>/dev/null || true)

RESP_NEW=$(echo "$SSE_NEW" | grep '"content"' | grep -v 'null' | tail -5 | tr -d '\n')
if echo "$RESP_NEW" | grep -qi "TestUser_Phase2"; then
  fail "New session leaked memory from old session"
else
  pass "New session has no memory of previous session"
fi

# ─── Check 5: Session history endpoint ───────────────────────────────────────
section "Check 5 — GET /api/chat/session/:id/history returns conversation"

STATUS=$(http_json GET "$API/api/chat/session/$SESSION_ID/history")
HBODY=$(body)
[[ "$STATUS" == "200" ]] && pass "GET /session/history → 200" || fail "GET /session/history → expected 200, got $STATUS"

HIST_LEN=$(echo "$HBODY" | jq '.history | length' 2>/dev/null || echo "0")
if [[ "$HIST_LEN" -ge 2 ]]; then
  pass "History has $HIST_LEN turns (expected ≥ 2)"
else
  fail "History too short (got $HIST_LEN turns)" "$HBODY"
fi

EST_TOKENS=$(echo "$HBODY" | jq -r '.estimatedTokens // empty')
[[ -n "$EST_TOKENS" ]] && pass "estimatedTokens present ($EST_TOKENS)" || fail "estimatedTokens missing"

# ─── Check 6: Session clear endpoint ─────────────────────────────────────────
section "Check 6 — DELETE /api/chat/session/:id clears history"

STATUS=$(http_json DELETE "$API/api/chat/session/$SESSION_ID")
CBODY=$(body)
[[ "$STATUS" == "200" ]] && pass "DELETE /session → 200" || fail "DELETE /session → expected 200, got $STATUS"

# Verify history is empty after clear
STATUS=$(http_json GET "$API/api/chat/session/$SESSION_ID/history")
HIST_AFTER=$(body | jq '.history | length' 2>/dev/null || echo "?")
[[ "$HIST_AFTER" == "0" ]] && pass "History cleared (0 turns after DELETE)" || fail "History not cleared (still $HIST_AFTER turns)"

# ─── Summary ──────────────────────────────────────────────────────────────────
TOTAL=$((PASS+FAIL))
log ""; log "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
log "${BOLD}  Results: ${GREEN}$PASS passed${RESET}  ${RED}$FAIL failed${RESET}  (total $TOTAL)${RESET}"
log "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
log "  Full log: $LOG_FILE"

if [[ $FAIL -gt 0 ]]; then
  log "${RED}${BOLD}  ✗ Phase 2 tests FAILED${RESET}"
  log "  Tip: docker compose -f $COMPOSE_DIR/docker-compose.yml logs api"
  exit 1
else
  log "${GREEN}${BOLD}  ✓ Phase 2 tests PASSED${RESET}"
fi

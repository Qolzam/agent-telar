#!/usr/bin/env bash
# Phase 1 — AI Gateway Test Suite
# Usage: bash phase1/test-phase1.sh [--no-rebuild]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/docker"
API="http://localhost:3000"
REBUILD=true
LOG_FILE="$SCRIPT_DIR/test-phase1.log"

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
  curl -s -o /tmp/ph1_body.json -w "%{http_code}" -X "$method" "$url" \
    -H "Content-Type: application/json" "$@" 2>>/tmp/ph1_curl_err.txt
}
body() { cat /tmp/ph1_body.json 2>/dev/null || echo '{}'; }

> "$LOG_FILE"
log ""
log "${BOLD}╔══════════════════════════════════════════╗${RESET}"
log "${BOLD}║   AgentTelar — Phase 1 Test Suite        ║${RESET}"
log "${BOLD}╚══════════════════════════════════════════╝${RESET}"
log "  Log: $LOG_FILE | API: $API | Rebuild: $REBUILD"

# ─── Prerequisites ────────────────────────────────────────────────────────────
section "Prerequisites"
command -v docker &>/dev/null && pass "docker installed" || { fail "docker not found"; exit 1; }
command -v jq    &>/dev/null && pass "jq installed"     || { fail "jq not found — brew install jq"; exit 1; }

# ─── Docker ───────────────────────────────────────────────────────────────────
section "Docker Stack"
cd "$COMPOSE_DIR"
if [[ "$REBUILD" == "true" ]]; then
  docker compose up --build -d 2>>"$LOG_FILE" && pass "docker compose up --build" \
    || { fail "docker compose up failed"; docker compose logs api 2>&1 | tail -20 | tee -a "$LOG_FILE"; exit 1; }
else
  docker compose up -d 2>>"$LOG_FILE" && pass "docker compose up"
fi

log "  Waiting for API to become healthy..."
MAX_WAIT=60; WAITED=0
until curl -sf "$API/health" >/dev/null 2>&1; do
  sleep 2; WAITED=$((WAITED+2))
  [[ $WAITED -ge $MAX_WAIT ]] && { fail "API not healthy after ${MAX_WAIT}s"; docker compose logs api 2>&1 | tail -30 | tee -a "$LOG_FILE"; exit 1; }
done
PHASE=$(curl -s "$API/health" | jq -r '.phase // empty')
pass "API healthy (phase=$PHASE)"
[[ "$PHASE" == "1" ]] || fail "Expected phase=1, got phase=$PHASE"

# ─── Check 1: GET /health ─────────────────────────────────────────────────────
section "Check 1 — GET /health returns { status: ok }"

STATUS=$(http_json GET "$API/health")
HBODY=$(body)
[[ "$STATUS" == "200" ]] && pass "GET /health → 200" || fail "GET /health → expected 200, got $STATUS"

STATUS_VAL=$(echo "$HBODY" | jq -r '.status // empty')
[[ "$STATUS_VAL" == "ok" ]] && pass "health.status = ok" || fail "health.status missing or wrong" "$HBODY"

VERSION=$(echo "$HBODY" | jq -r '.version // empty')
[[ -n "$VERSION" ]] && pass "health.version present ($VERSION)" || fail "health.version missing"

debug "Health response: $(echo "$HBODY" | jq -c .)"

# ─── Check 2: POST /api/chat streams SSE events ───────────────────────────────
section "Check 2 — POST /api/chat returns streaming SSE events"

SSE_OUT=$(curl -s -N -X POST "$API/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"Say hello in exactly 5 words.","temperature":0.1}' \
  --max-time 30 2>/dev/null || true)

debug "Raw SSE output (first 300 chars): ${SSE_OUT:0:300}"

if echo "$SSE_OUT" | grep -q 'event: token'; then
  pass "SSE 'token' events present in response"
else
  fail "No 'event: token' found in SSE stream" "got: ${SSE_OUT:0:200}"
fi

if echo "$SSE_OUT" | grep -q 'event: done'; then
  pass "SSE 'done' event present"
else
  fail "No 'event: done' found in SSE stream"
fi

DONE_DATA=$(echo "$SSE_OUT" | grep '^data:' | tail -1 | sed 's/^data: //')
if echo "$DONE_DATA" | jq -e '.usage' >/dev/null 2>&1; then
  TOKENS=$(echo "$DONE_DATA" | jq -r '.usage.totalTokens // .usage.completionTokens // "?"')
  COST=$(echo "$DONE_DATA" | jq -r '.usage.estimatedCostUSD // "?"')
  pass "Token usage present in 'done' event (tokens=$TOKENS, cost=\$$COST)"
else
  fail "Token usage missing from 'done' event" "$DONE_DATA"
fi

# ─── Check 3: Invalid request → 400 ──────────────────────────────────────────
section "Check 3 — Invalid request body returns 400 with validation errors"

STATUS=$(http_json POST "$API/api/chat" -d '{}')
[[ "$STATUS" == "400" ]] && pass "Empty body → 400" || fail "Empty body — expected 400, got $STATUS"

STATUS=$(http_json POST "$API/api/chat" -d '{"message":""}')
[[ "$STATUS" == "400" ]] && pass "Empty message → 400" || fail "Empty message — expected 400, got $STATUS"

DETAILS=$(body | jq -e '.details' >/dev/null 2>&1 && echo "yes" || echo "no")
[[ "$DETAILS" == "yes" ]] && pass "Validation error details present in 400 body" || fail "No .details in 400 response" "$(body)"

# ─── Check 4: Rate limiting → 429 ────────────────────────────────────────────
section "Check 4 — Rate limiting returns 429 after limit exceeded"

log "  Sending 25 rapid requests..."
GOT_429=false
for i in $(seq 1 25); do
  SC=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/chat" \
    -H "Content-Type: application/json" -d '{"message":"ping"}' 2>/dev/null)
  if [[ "$SC" == "429" ]]; then
    GOT_429=true
    debug "Got 429 on request #$i"
    break
  fi
done
[[ "$GOT_429" == "true" ]] && pass "Rate limiter returned 429" || fail "Expected 429 after burst — not triggered"

# ─── Check 5: Docker image built and running ──────────────────────────────────
section "Check 5 — Docker image built and container healthy"

CONTAINER_STATUS=$(docker compose ps --format json 2>/dev/null | \
  jq -r 'if type == "array" then .[0].State else .State end' 2>/dev/null || \
  docker compose ps 2>/dev/null | grep 'api' | awk '{print $4}' | head -1)
debug "Container state: $CONTAINER_STATUS"
[[ "$CONTAINER_STATUS" == "running" || "$CONTAINER_STATUS" == "Up" ]] \
  && pass "API container is running" || fail "Container not running (state: $CONTAINER_STATUS)"

IMAGE=$(docker compose images 2>/dev/null | grep 'api' | awk '{print $3}')
[[ -n "$IMAGE" ]] && pass "Docker image exists" || fail "Docker image not found"

# ─── Summary ──────────────────────────────────────────────────────────────────
TOTAL=$((PASS+FAIL))
log ""; log "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
log "${BOLD}  Results: ${GREEN}$PASS passed${RESET}  ${RED}$FAIL failed${RESET}  (total $TOTAL)${RESET}"
log "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
log "  Full log: $LOG_FILE"

if [[ $FAIL -gt 0 ]]; then
  log "${RED}${BOLD}  ✗ Phase 1 tests FAILED${RESET}"
  log "  Tip: docker compose -f $COMPOSE_DIR/docker-compose.yml logs api"
  exit 1
else
  log "${GREEN}${BOLD}  ✓ Phase 1 tests PASSED${RESET}"
fi

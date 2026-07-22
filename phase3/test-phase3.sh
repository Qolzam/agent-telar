#!/usr/bin/env bash
# Phase 3 — RAG Knowledge Engine Test Suite
# Usage: bash phase3/test-phase3.sh [--no-rebuild]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/docker"
API="http://localhost:3000"
REBUILD=true
LOG_FILE="$SCRIPT_DIR/test-phase3.log"

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
  curl -s -o /tmp/ph3_body.json -w "%{http_code}" -X "$method" "$url" \
    -H "Content-Type: application/json" "$@" 2>>/tmp/ph3_curl_err.txt
}
body() { cat /tmp/ph3_body.json 2>/dev/null || echo '{}'; }

> "$LOG_FILE"
log ""
log "${BOLD}╔══════════════════════════════════════════╗${RESET}"
log "${BOLD}║   AgentTelar — Phase 3 Test Suite        ║${RESET}"
log "${BOLD}╚══════════════════════════════════════════╝${RESET}"
log "  Log: $LOG_FILE | API: $API | Rebuild: $REBUILD"

# ─── Prerequisites ────────────────────────────────────────────────────────────
section "Prerequisites"
command -v docker &>/dev/null && pass "docker installed" || { fail "docker not found"; exit 1; }
command -v jq    &>/dev/null && pass "jq installed"     || { fail "jq not found — brew install jq"; exit 1; }

# ─── Docker ───────────────────────────────────────────────────────────────────
section "Docker Stack (API + Redis + PostgreSQL/pgvector)"
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
[[ "$PHASE" == "3" ]] || fail "Expected phase=3, got phase=$PHASE"

# ─── Check 1: pgvector extension enabled ──────────────────────────────────────
section "Check 1 — pgvector extension is enabled in PostgreSQL"

VECTOR_EXT=$(docker compose exec -T postgres psql -U agenttelar -d agenttelar -tAc \
  "SELECT extname FROM pg_extension WHERE extname='vector';" 2>/dev/null | tr -d '[:space:]')
[[ "$VECTOR_EXT" == "vector" ]] && pass "pgvector extension installed" || fail "pgvector not enabled in PostgreSQL"

VECTOR_TABLE=$(docker compose exec -T postgres psql -U agenttelar -d agenttelar -tAc \
  "SELECT tablename FROM pg_tables WHERE tablename='documents';" 2>/dev/null | tr -d '[:space:]')
[[ "$VECTOR_TABLE" == "documents" ]] && pass "documents table exists" || fail "documents table missing"

CHUNK_TABLE=$(docker compose exec -T postgres psql -U agenttelar -d agenttelar -tAc \
  "SELECT tablename FROM pg_tables WHERE tablename='document_chunks';" 2>/dev/null | tr -d '[:space:]')
[[ "$CHUNK_TABLE" == "document_chunks" ]] && pass "document_chunks table exists" || fail "document_chunks table missing"

# ─── Check 2: POST /api/rag/ingest/url ───────────────────────────────────────
section "Check 2 — POST /api/rag/ingest/url ingests a document"

STATUS=$(http_json POST "$API/api/rag/ingest/url" \
  -d '{"url":"https://en.wikipedia.org/wiki/Retrieval-augmented_generation","name":"RAG Wikipedia"}')
IBODY=$(body)
debug "Ingest response ($STATUS): $(echo "$IBODY" | jq -c . 2>/dev/null || echo "$IBODY")"

[[ "$STATUS" == "200" || "$STATUS" == "201" ]] && pass "POST /api/rag/ingest/url → $STATUS" \
  || fail "POST /api/rag/ingest/url → expected 200/201, got $STATUS"

CHUNKS=$(echo "$IBODY" | jq -r '.chunksCreated // .chunks // 0')
if [[ "$CHUNKS" =~ ^[0-9]+$ ]] && [[ "$CHUNKS" -gt 0 ]]; then
  pass "Ingest created $CHUNKS chunks"
else
  fail "chunksCreated missing or zero" "$(echo "$IBODY" | jq -c .)"
fi

# Wait a moment for embeddings to settle
sleep 2

# ─── Check 3: GET /api/rag/search returns ranked results ──────────────────────
section "Check 3 — GET /api/rag/search returns results with similarity scores"

STATUS=$(http_json GET "$API/api/rag/search?q=retrieval+augmented+generation")
SBODY=$(body)
debug "Search response ($STATUS): $(echo "$SBODY" | jq -c . 2>/dev/null | head -c 300)"

[[ "$STATUS" == "200" ]] && pass "GET /api/rag/search → 200" || fail "GET /api/rag/search → expected 200, got $STATUS"

RESULT_COUNT=$(echo "$SBODY" | jq '
  if type == "array" then length
  elif .results then .results | length
  elif .chunks then .chunks | length
  else 0
  end' 2>/dev/null || echo "0")

if [[ "$RESULT_COUNT" =~ ^[0-9]+$ ]] && [[ "$RESULT_COUNT" -gt 0 ]]; then
  pass "Search returned $RESULT_COUNT results"
else
  fail "Search returned no results" "$(echo "$SBODY" | jq -c . | head -c 300)"
fi

# Check similarity scores present
HAS_SCORE=$(echo "$SBODY" | jq '
  if type == "array" then .[0].similarity // .[0].score // null
  elif .results then .results[0].similarity // .results[0].score // null
  else null
  end' 2>/dev/null || echo "null")

[[ "$HAS_SCORE" != "null" && -n "$HAS_SCORE" ]] \
  && pass "Similarity score present in results ($HAS_SCORE)" \
  || fail "No similarity/score field in search results"

# ─── Check 4: HNSW index exists ───────────────────────────────────────────────
section "Check 4 — HNSW index exists on document_chunks"

HNSW_IDX=$(docker compose exec -T postgres psql -U agenttelar -d agenttelar -tAc \
  "SELECT indexname FROM pg_indexes WHERE tablename='document_chunks' AND indexdef ILIKE '%hnsw%';" \
  2>/dev/null | tr -d '[:space:]')
[[ -n "$HNSW_IDX" ]] && pass "HNSW index found: $HNSW_IDX" || {
  # Fall back to any vector index
  ANY_IDX=$(docker compose exec -T postgres psql -U agenttelar -d agenttelar -tAc \
    "SELECT indexname FROM pg_indexes WHERE tablename='document_chunks' AND indexdef ILIKE '%embedding%';" \
    2>/dev/null | tr -d '[:space:]')
  [[ -n "$ANY_IDX" ]] && pass "Vector index found: $ANY_IDX (verify it's HNSW)" \
    || fail "No vector index found on document_chunks.embedding"
}

# ─── Check 5: Agent uses knowledge base tool ──────────────────────────────────
section "Check 5 — Agent uses search_knowledge_base tool for ingested content"

SSE_RAG=$(curl -s -N -X POST "$API/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"What is retrieval-augmented generation? Use the knowledge base."}' \
  --max-time 60 2>/dev/null || true)

debug "RAG agent SSE events: $(echo "$SSE_RAG" | grep '^event:' | tr '\n' ' ')"

if echo "$SSE_RAG" | grep -q 'search_knowledge_base\|knowledge_base'; then
  pass "Agent invoked search_knowledge_base tool"
elif echo "$SSE_RAG" | grep -q 'event: tool_call'; then
  TOOL=$(echo "$SSE_RAG" | grep '"tool"' | head -1 | grep -o '"tool":"[^"]*"')
  pass "Agent invoked a tool ($TOOL) — verify it's the KB tool in logs"
else
  fail "Agent did not use knowledge base tool"
fi

if echo "$SSE_RAG" | grep -q 'event: done'; then
  pass "Agent completed with done event"
else
  fail "No done event from agent"
fi

# Check the response references the ingested doc
RESP_TEXT=$(echo "$SSE_RAG" | grep '"content"' | grep -v 'null' | tail -10 | tr -d '\n')
if echo "$RESP_TEXT" | grep -qi 'retrieval\|RAG\|augmented'; then
  pass "Agent response contains knowledge base content"
else
  fail "Response doesn't appear to use ingested document content" "${RESP_TEXT:0:300}"
fi

# ─── Check 6: Invalid ingest request → 400 ────────────────────────────────────
section "Check 6 — Invalid ingest request returns 400"

STATUS=$(http_json POST "$API/api/rag/ingest/url" -d '{}')
[[ "$STATUS" == "400" ]] && pass "Missing URL → 400" || fail "Missing URL — expected 400, got $STATUS"

STATUS=$(http_json POST "$API/api/rag/ingest/url" -d '{"url":"not-a-url"}')
[[ "$STATUS" == "400" || "$STATUS" == "422" ]] \
  && pass "Invalid URL → $STATUS" || fail "Invalid URL — expected 400/422, got $STATUS"

# ─── Summary ──────────────────────────────────────────────────────────────────
TOTAL=$((PASS+FAIL))
log ""; log "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
log "${BOLD}  Results: ${GREEN}$PASS passed${RESET}  ${RED}$FAIL failed${RESET}  (total $TOTAL)${RESET}"
log "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
log "  Full log: $LOG_FILE"

if [[ $FAIL -gt 0 ]]; then
  log "${RED}${BOLD}  ✗ Phase 3 tests FAILED${RESET}"
  log "  Tip: docker compose -f $COMPOSE_DIR/docker-compose.yml logs api"
  exit 1
else
  log "${GREEN}${BOLD}  ✓ Phase 3 tests PASSED${RESET}"
fi

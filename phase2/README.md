# Phase 2 — Smart Agent with Memory

ReAct agent on top of Phase 1: tool calling (weather, calculator, Wikipedia, datetime), Redis session memory, and richer SSE events (`tool_call`, `tool_result`, `token`, `done`).

```
Client → POST /api/chat → load Redis history → ReAct loop + tools → SSE → save turn
```

## What's included

| Path | Purpose |
|------|---------|
| `apps/api/` | Express API — agent loop, tools, chat routes |
| `apps/api/src/services/agent.service.ts` | LangGraph ReAct stream |
| `apps/api/src/services/memory.service.ts` | Redis history (`MAX_HISTORY` trim, 7-day TTL) |
| `apps/api/src/tools/index.ts` | Four tools + schemas |
| `docker/docker-compose.yml` | API + Redis + PostgreSQL (`name: agenttelar-phase2`) |
| `test-phase2.sh` | Integration suite (tools, memory, session APIs) |

Compose uses a **unique project name** (`agenttelar-phase2`) so its volumes do not collide with Phase 1 or Phase 3.

## Prerequisites

- Docker Desktop
- Groq API key from [console.groq.com](https://console.groq.com)

## Configuration

```bash
cd apps/api
cp .env.example .env
# Set GROQ_API_KEY
```

| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | — | Required |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Chat model |
| `REDIS_URL` | `redis://localhost:6379` | Session memory (Compose overrides to `redis://redis:6379`) |
| `DATABASE_URL` | local Postgres URL | Provisioned for later phases; unused by Phase 2 app code |
| `RATE_LIMIT_MAX_REQUESTS` | `20` | Compose overrides to `100` |

Phase 2 has its **own** `.env` — it does not reuse Phase 1's.

## Run with Docker (recommended)

**One phase at a time.** Compose project names keep volumes separate, but host ports are shared (`:3000` for every phase; Phase 2/3 also use `:6379` and `:5432`). Always `docker compose down` the previous phase before `up` on the next.

Stop anything already bound to those ports (e.g. Phase 1):

```bash
# From repo root, if Phase 1 is still up:
#   cd phase1/docker && docker compose down

cd phase2
cp apps/api/.env.example apps/api/.env   # then set GROQ_API_KEY
cd docker && docker compose up --build -d
```

```bash
curl http://localhost:3000/health
# {"status":"ok","phase":2,...}
```

## Quick curl checks

```bash
# Capture X-Session-ID from headers
curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"My name is Alex"}' --no-buffer -i

curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"What is my name?","sessionId":"<SESSION_ID>"}' --no-buffer

curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"What is the weather in Tokyo right now?"}' --no-buffer
```

## Testing

```bash
cd apps/api && pnpm test          # unit tests
bash test-phase2.sh               # full Docker integration suite
```

## Troubleshooting

**`Bind for 0.0.0.0:3000 failed` (or `:6379` / `:5432`)** — another phase is still running. Stop it: `cd ../phase1/docker && docker compose down`. That frees the shared host ports; volumes stay intact for when you return.

**Redis connection errors** — wait until `docker compose ps` shows Redis healthy; API depends on it.

**No tool_call for weather** — confirm Groq key is valid and the model can call tools; check API logs with `docker compose logs api`.

## Learn more

Walkthrough and quiz: [Telar Academy — Smart Agent](https://academy.telar.dev/phases/smart-agent)

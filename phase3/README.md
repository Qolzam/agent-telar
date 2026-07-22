# Phase 3 — RAG Knowledge Engine

Adds document ingest, embeddings (`text-embedding-3-small`), pgvector storage, hybrid search (vector + PostgreSQL `ts_rank` / RRF), and a fifth agent tool: `search_knowledge_base`.

```
Upload/URL → chunk → embed → Postgres/pgvector
Query → embed → hybridSearch → agent tool → SSE answer (prompt-instructed grounding)
```

## What's included

| Path | Purpose |
|------|---------|
| `apps/api/src/routes/rag.ts` | Ingest file/URL + search |
| `apps/api/src/services/vectorstore.service.ts` | Transactional ingest, similarity + hybrid search |
| `apps/api/src/services/chunker.service.ts` | Character-based chunks (512 / overlap 50) |
| `apps/api/src/tools/index.ts` | Phase 2 tools + `search_knowledge_base` |
| `docker/docker-compose.yml` | API + Redis + `pgvector/pgvector:pg16` (`name: agenttelar-phase3`) |
| `docker/init.sql` | Extension, tables, HNSW + FTS indexes |
| `test-phase3.sh` | Integration suite |

Compose project name is **`agenttelar-phase3`**, so Postgres volumes do not share with Phase 1/2.

## Prerequisites

- Docker Desktop
- Groq API key ([console.groq.com](https://console.groq.com))
- OpenAI API key for embeddings ([platform.openai.com](https://platform.openai.com/api-keys))

## Configuration

```bash
cd apps/api
cp .env.example .env
# Set GROQ_API_KEY and OPENAI_API_KEY
```

| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | — | Required (chat agent) |
| `OPENAI_API_KEY` | — | Required (embeddings) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | 1536-dim vectors |
| `REDIS_URL` | local Redis | Session memory |
| `DATABASE_URL` | local Postgres | Overridden in Compose to the pgvector service |

## Run with Docker (recommended)

**One phase at a time.** Volumes are isolated (`agenttelar-phase3`), but Phase 2 and Phase 3 both publish `:3000`, `:6379`, and `:5432`. Stop Phase 2 (or anything on those ports) first:

```bash
# cd ../phase2/docker && docker compose down

cd phase3
cp apps/api/.env.example apps/api/.env   # set both API keys
cd docker && docker compose up --build -d
```

```bash
curl http://localhost:3000/health
# {"status":"ok","phase":3,...}

docker compose exec postgres psql -U agenttelar -c \
  "SELECT extname FROM pg_extension WHERE extname='vector';"
# one row expected
```

If `vector` is missing (rare — usually an old leftover volume), reset once:

```bash
docker compose down -v && docker compose up --build -d
```

## Quick curl checks

```bash
# Ingest a small markdown file, then search + chat (see Telar Academy Phase 3 for full script)
curl -X POST http://localhost:3000/api/rag/ingest/file -F 'file=@/tmp/Refund-Policy.md'
curl "http://localhost:3000/api/rag/search?q=how+long+do+refunds+take"
```

## Testing

```bash
cd apps/api && pnpm test
bash test-phase3.sh
```

## Troubleshooting

**`Bind for 0.0.0.0:3000 failed` (or `:6379` / `:5432`)** — Phase 2 (or another stack) is still up. Run `cd ../phase2/docker && docker compose down`. Volumes are per-project; you are only freeing ports.

**`OPENAI_API_KEY is required`** — embeddings need a real OpenAI key in `.env`; Compose loads that file.

**Empty `pg_extension` for `vector`** — `init.sql` only runs on first volume create. Use `docker compose down -v` once, then `up` again.

## Learn more

Walkthrough and quiz: [Telar Academy — RAG Engine](https://academy.telar.dev/phases/rag-engine)

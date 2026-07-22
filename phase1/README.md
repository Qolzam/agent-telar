# Phase 1 — AI Gateway

Express API that proxies chat requests to [Groq](https://console.groq.com) and streams responses back to the client over Server-Sent Events (SSE).

```
Client  →  POST /api/chat  →  Groq (stream)  →  SSE token events  →  Client
```

## What's included

| Path | Purpose |
|------|---------|
| `apps/api/` | TypeScript API — routes, Groq integration, validation |
| `apps/api/src/config/env.ts` | Zod-validated environment config |
| `apps/api/src/services/llm.service.ts` | Groq streaming client and per-request cost estimate |
| `apps/api/src/routes/chat.ts` | SSE chat endpoint |
| `docker/docker-compose.yml` | Containerized dev stack |
| `test-phase1.sh` | Integration test suite (health, SSE, validation, Docker) |

## Prerequisites

- Node.js 20+
- pnpm 9+ (or npm)
- Docker Desktop (for containerized runs)
- Groq API key from [console.groq.com](https://console.groq.com)

## Configuration

Copy the example env file and add your API key:

```bash
cd apps/api
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | — | Required. Groq API key (`gsk_…`) |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Model passed to Groq |
| `PORT` | `3000` | HTTP listen port |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | `20` | Max requests per window |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated CORS origins |

Docker Compose overrides `RATE_LIMIT_MAX_REQUESTS` to `100` in `docker/docker-compose.yml`.

## Run locally

```bash
cd apps/api
pnpm install
pnpm dev
```

Verify:

```bash
curl http://localhost:3000/health
```

## Run with Docker

```bash
cd docker
docker compose up --build
```

The Compose project is named `agenttelar-phase1` so its volumes do not collide with later phases. The API listens on `http://localhost:3000`. Compose reads `apps/api/.env` for `GROQ_API_KEY`.

When you move to Phase 2, stop this stack first (`docker compose down` here) so `:3000` is free.

## API

### `GET /health`

```json
{ "status": "ok", "version": "1.0.0", "phase": 1, "timestamp": "…" }
```

### `POST /api/chat`

Streams a chat completion. Request body:

```json
{
  "message": "Explain SSE in one sentence",
  "history": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "systemPrompt": "You are a concise technical assistant."
}
```

| Field | Required | Constraints |
|-------|----------|-------------|
| `message` | yes | 1–10 000 characters |
| `history` | no | Up to 50 prior turns (`user` / `assistant`) |
| `temperature` | no | 0–2 |
| `systemPrompt` | no | Max 5 000 characters; defaults to built-in AgentTelar prompt |

Response is `text/event-stream`:

```
event: token
data: {"text":"Server"}

event: done
data: {"fullResponse":"…","usage":{"promptTokens":…,"completionTokens":…,"totalTokens":…,"estimatedCostUSD":…}}
```

Example:

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Say hello in three words"}' \
  --no-buffer
```

On validation failure the API returns `400` with a Zod error payload. Rate-limited clients receive `429`.

### `GET /api/chat/health`

Lightweight route health check under the chat router.

## Testing

Unit tests (mocked LLM, no API key required):

```bash
cd apps/api
pnpm test
```

Full integration suite (requires Docker, valid `GROQ_API_KEY` in `.env`):

```bash
bash test-phase1.sh
```

Pass `--no-rebuild` to skip image rebuild on subsequent runs.

## Troubleshooting

**`GROQ_API_KEY is required` on startup** — `.env` is missing or the key is empty. Copy from `.env.example` and set a valid `gsk_` key.

**No streamed output in curl** — pass `--no-buffer` (or `-N`). Buffered curl waits for the full response.

**`429 Too many requests`** — local rate limit hit. Wait for the window to reset (`RATE_LIMIT_WINDOW_MS`) or raise `RATE_LIMIT_MAX_REQUESTS` in `.env`.

**Docker compose fails to connect** — ensure Docker Desktop is running before `docker compose up`.

**Moving to Phase 2 / port already allocated** — run `docker compose down` in this `docker/` folder first. Volumes for `agenttelar-phase1` stay on disk; you only release `:3000`.

## Security notes

- Never commit `.env` — it is listed in `.gitignore`.
- Helmet, CORS, JSON body size limits (50 KB), and per-IP rate limiting are enabled in `src/index.ts`.
- Production error responses omit internal error messages when `NODE_ENV=production`.

# Agent Telar

Agent Telar is a hands-on project where I build an AI agent platform step by step. It starts with a streaming LLM API and grows through tools, memory, RAG, multi-agent workflows, authentication, queues, observability, microservices and Kubernetes.

The long-term design target is to prepare the platform for 1 million active users. The project does not claim that scale has already been reached. Each phase adds a production-oriented pattern and a testable snapshot.

[Read the phase guides and architecture explanations at Telar Academy](https://academy.telar.dev)

> **Current public release:** Phases 1–3 (AI Gateway, Smart Agent, RAG Engine). Later phases will be published after their code, setup instructions and tests are ready for a clean checkout.

## Why I am building it

Many AI examples stop after one model call. Agent Telar shows what comes next: validation, streaming, retrieval, tools, failure handling, observability, deployment and cost.

Each phase keeps the code runnable and explains the decisions behind it.

## Roadmap

| Phase | Focus | Public status |
|---:|---|---|
| 1 | AI Gateway: Groq, SSE, validation, rate limiting and cost tracking | Published |
| 2 | Smart Agent: tools, ReAct and Redis memory | Published |
| 3 | RAG Engine: ingestion, embeddings and hybrid search | Published |
| 4 | Multi-Agent Orchestration | Not published yet |
| 5 | Authentication, tenants, metering and background jobs | Not published yet |
| 6 | Real-time streaming and event queues | Not published yet |
| 7 | Observability and AI evaluation | Not published yet |
| 8 | Containerized microservices and CI/CD | Not published yet |
| 9 | Kubernetes, autoscaling and GitOps | Not published yet |
| 10 | Terraform, load testing and FinOps | Planned |

## Phase 1: AI Gateway

Phase 1 provides a small Express API that streams Groq responses over Server-Sent Events.

It includes:

- TypeScript and Express
- Groq streaming through SSE
- Zod request and environment validation
- Token usage and estimated cost in the final event
- Helmet, CORS, request-size limits and per-IP rate limiting
- Docker Compose
- Vitest unit tests and a shell integration test

```text
Client -> POST /api/chat -> Groq streaming -> SSE token events -> Client
```

Setup: [phase1/README.md](./phase1/README.md)

## Phase 2: Smart Agent with Memory

Phase 2 turns the gateway into a ReAct agent with tools and Redis session memory.

It includes:

- LangChain / LangGraph ReAct loop
- Tools: weather, calculator, Wikipedia, datetime
- Redis-backed conversation history with trim + TTL
- SSE events for `tool_call`, `tool_result`, `token`, and `done`
- Session history and clear endpoints

```text
Client -> POST /api/chat -> Redis history -> ReAct + tools -> SSE -> save turn
```

Setup: [phase2/README.md](./phase2/README.md) — run **one phase stack at a time** (shared host ports `:3000`, `:6379`, `:5432`; Compose volumes are isolated per phase).

## Phase 3: RAG Knowledge Engine

Phase 3 adds document ingest, embeddings, pgvector storage, hybrid search, and a `search_knowledge_base` agent tool.

It includes:

- File and URL ingest with transactional chunk writes
- OpenAI `text-embedding-3-small` (1536-dim) + pgvector HNSW
- Hybrid search (vector + BM25 via Reciprocal Rank Fusion)
- Agent grounding on ingested company docs

```text
Upload -> chunk -> embed -> Postgres/pgvector
Query -> hybridSearch -> agent tool -> grounded SSE answer
```

Setup: [phase3/README.md](./phase3/README.md) — needs `GROQ_API_KEY` and `OPENAI_API_KEY`.

## Run a published phase

Each phase is a self-contained snapshot. Prefer Docker Compose from that phase’s `docker/` folder after copying `apps/api/.env.example` → `.env`.

```bash
git clone https://github.com/Qolzam/agent-telar.git
cd agent-telar/phase2   # or phase1 / phase3
cp apps/api/.env.example apps/api/.env
# Add required API keys, then:
cd docker && docker compose up --build -d
curl http://localhost:3000/health
```

Stop the previous phase with `docker compose down` in its `docker/` folder before starting another (ports are shared; volumes are not).

## Tests

Unit tests (no live model required for most cases):

```bash
cd phase2/apps/api   # or phase1 / phase3
pnpm install
pnpm test
```

Docker integration suites (need valid keys in that phase’s `.env`):

```bash
bash phase2/test-phase2.sh
bash phase3/test-phase3.sh
```

## Scale target

Later phases work toward a design target of 1 million active users. The target will be defined and tested using:

- Active-user period: daily or monthly
- Requests per user per day
- Average and peak requests per second
- Concurrent SSE and WebSocket connections
- p50, p95 and p99 latency
- Error rate and test duration
- Exact infrastructure used by the test

Published results will distinguish a modeled workload, a load-tested result and real production traffic.

## Project structure

```text
agent-telar/
├── phase1/                # AI Gateway (published)
├── phase2/                # Smart Agent (published)
├── phase3/                # RAG Engine (published)
│   ├── apps/api/
│   ├── docker/            # unique Compose project name per phase
│   ├── README.md
│   └── test-phase*.sh
└── README.md
```

Each published phase stays as a runnable snapshot so you can inspect the architecture at that point in the project.

## Documentation

- [Telar Academy](https://academy.telar.dev)
- [Phase 1 — AI Gateway](https://academy.telar.dev/phases/ai-gateway) · [source](./phase1)
- [Phase 2 — Smart Agent](https://academy.telar.dev/phases/smart-agent) · [source](./phase2)
- [Phase 3 — RAG Engine](https://academy.telar.dev/phases/rag-engine) · [source](./phase3)

## Security

Never commit API keys or local `.env` files. Copy the provided `.env.example` file and keep real values only in your local environment or secret manager.

## Author

Built by [Amirhossein Movahedi](https://github.com/Qolzam). You can also find me on [LinkedIn](https://linkedin.com/in/Qolzam).

## License

MIT. See [LICENSE](./LICENSE).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import { chatRouter } from '../routes/chat';

// Mock agent and memory services — tests never touch Redis or Groq
vi.mock('../services/agent.service', () => ({
  runAgentStream: vi.fn(async function* () {
    yield { type: 'token', content: 'Hello', metadata: undefined };
    yield { type: 'done', content: 'Hello', metadata: { toolsUsed: [] } };
  }),
}));

vi.mock('../services/memory.service', () => ({
  memoryService: {
    getHistory: vi.fn().mockResolvedValue([]),
    appendTurn: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined),
    getTokenEstimate: vi.fn().mockResolvedValue(42),
  },
}));

vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3000,
    GROQ_API_KEY: 'test-key',
    GROQ_MODEL: 'llama-3.3-70b-versatile',
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: 'postgres://agenttelar:secret@localhost:5432/agenttelar',
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX_REQUESTS: 20,
    ALLOWED_ORIGINS: 'http://localhost:5173',
  },
}));

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRouter);
  return app;
}

describe('GET /api/chat/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(buildApp()).get('/api/chat/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/chat', () => {
  let app: Express;
  beforeEach(() => { app = buildApp(); });

  it('streams SSE events and sets X-Session-ID header', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Hello' })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-session-id']).toBeDefined();
    expect(res.body).toContain('event: token');
    expect(res.body).toContain('event: done');
  });

  it('uses provided sessionId', async () => {
    const sessionId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Hello', sessionId })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    expect(res.headers['x-session-id']).toBe(sessionId);
  });

  it('returns 400 for missing message', async () => {
    const res = await request(app).post('/api/chat').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('returns 400 for non-UUID sessionId', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Hi', sessionId: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/chat/session/:sessionId/history', () => {
  it('returns history and token estimate', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/chat/session/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/history');
    expect(res.status).toBe(200);
    expect(res.body.history).toEqual([]);
    expect(res.body.estimatedTokens).toBe(42);
    expect(res.body.sessionId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

describe('DELETE /api/chat/session/:sessionId', () => {
  it('clears the session and confirms', async () => {
    const app = buildApp();
    const res = await request(app)
      .delete('/api/chat/session/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Session cleared');
  });
});

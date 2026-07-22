import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import { chatRouter } from '../routes/chat';

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
    getTokenEstimate: vi.fn().mockResolvedValue(0),
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

describe('POST /api/chat — request validation', () => {
  it('accepts a valid message without sessionId', async () => {
    const res = await request(buildApp())
      .post('/api/chat')
      .send({ message: 'Hello' })
      .buffer(true)
      .parse((res, cb) => {
        let d = ''; res.on('data', (c: Buffer) => { d += c; }); res.on('end', () => cb(null, d));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('accepts a valid message with a UUID sessionId', async () => {
    const res = await request(buildApp())
      .post('/api/chat')
      .send({ message: 'Hello', sessionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
      .buffer(true)
      .parse((res, cb) => {
        let d = ''; res.on('data', (c: Buffer) => { d += c; }); res.on('end', () => cb(null, d));
      });
    expect(res.status).toBe(200);
  });

  it('rejects an empty message', async () => {
    const res = await request(buildApp()).post('/api/chat').send({ message: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('rejects a message over 10000 chars', async () => {
    const res = await request(buildApp()).post('/api/chat').send({ message: 'a'.repeat(10001) });
    expect(res.status).toBe(400);
  });

  it('rejects a non-UUID sessionId', async () => {
    const res = await request(buildApp())
      .post('/api/chat')
      .send({ message: 'Hi', sessionId: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });
});

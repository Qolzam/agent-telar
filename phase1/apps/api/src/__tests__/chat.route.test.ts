import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import { chatRouter } from '../routes/chat';

// Mock the LLM service so tests never hit the real Groq API
vi.mock('../services/llm.service', () => ({
  streamChat: vi.fn(async function* () {
    yield { text: 'Hello', done: false };
    yield {
      text: '',
      done: true,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCostUSD: 0.000009 },
    };
  }),
}));

// Mock env so tests don't require a real .env file
vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3000,
    GROQ_API_KEY: 'test-key',
    GROQ_MODEL: 'llama-3.3-70b-versatile',
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
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('POST /api/chat', () => {
  let app: Express;
  beforeEach(() => { app = buildApp(); });

  it('streams SSE events for a valid request', async () => {
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
    expect(res.body).toContain('event: token');
    expect(res.body).toContain('event: done');
  });

  it('returns 400 for missing message', async () => {
    const res = await request(app).post('/api/chat').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('returns 400 for empty message', async () => {
    const res = await request(app).post('/api/chat').send({ message: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for temperature out of range', async () => {
    const res = await request(app).post('/api/chat').send({ message: 'Hi', temperature: 5 });
    expect(res.status).toBe(400);
  });
});

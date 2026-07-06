import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import { chatRouter } from '../routes/chat';

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

describe('POST /api/chat — request validation', () => {
  it('accepts a valid minimal request', async () => {
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

  it('accepts a full valid request with history, temperature, and systemPrompt', async () => {
    const res = await request(buildApp())
      .post('/api/chat')
      .send({
        message: 'Hello',
        history: [{ role: 'user', content: 'Hi' }],
        temperature: 0.5,
        systemPrompt: 'Be helpful',
      })
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

  it('rejects temperature out of range', async () => {
    const res = await request(buildApp()).post('/api/chat').send({ message: 'Hi', temperature: 3 });
    expect(res.status).toBe(400);
  });

  it('rejects invalid role in history', async () => {
    const res = await request(buildApp())
      .post('/api/chat')
      .send({ message: 'Hi', history: [{ role: 'system', content: 'bad' }] });
    expect(res.status).toBe(400);
  });

  it('rejects history with more than 50 turns', async () => {
    const res = await request(buildApp())
      .post('/api/chat')
      .send({
        message: 'Hi',
        history: Array.from({ length: 51 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'msg',
        })),
      });
    expect(res.status).toBe(400);
  });
});

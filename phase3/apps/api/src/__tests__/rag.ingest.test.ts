import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const loadDocument = vi.fn();
const ingestDocument = vi.fn();

vi.mock('../services/loader.service', () => ({
  loadDocument: (...args: unknown[]) => loadDocument(...args),
}));

vi.mock('../services/vectorstore.service', () => ({
  vectorStore: {
    ingestDocument: (...args: unknown[]) => ingestDocument(...args),
    hybridSearch: vi.fn(),
  },
}));

vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3000,
    GROQ_API_KEY: 'test-key',
    GROQ_MODEL: 'llama-3.3-70b-versatile',
    OPENAI_API_KEY: 'test-openai',
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: 'postgres://agenttelar:secret@localhost:5432/agenttelar',
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX_REQUESTS: 20,
    ALLOWED_ORIGINS: 'http://localhost:5173',
  },
}));

import { ragRouter } from '../routes/rag';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/rag', ragRouter);
  return app;
}

describe('POST /api/rag/ingest/file', () => {
  beforeEach(() => {
    loadDocument.mockReset();
    ingestDocument.mockReset();
  });

  it('passes originalname as filenameHint for type detection', async () => {
    const tmpFile = path.join(os.tmpdir(), `agenttelar-upload-${Date.now()}.bin`);
    await fs.writeFile(tmpFile, 'refunds take five to seven days');
    // Multer writes its own temp file; we simulate via attaching through supertest multipart.
    // The route should call loadDocument(tempPath, originalname).
    loadDocument.mockResolvedValue({ content: 'refunds take five to seven days', type: 'md' });
    ingestDocument.mockResolvedValue({
      documentId: 'doc-1',
      name: 'Refund-Policy.md',
      chunksCreated: 1,
    });

    const res = await request(buildApp())
      .post('/api/rag/ingest/file')
      .attach('file', tmpFile, 'Refund-Policy.md');

    expect(res.status).toBe(200);
    expect(loadDocument).toHaveBeenCalled();
    const [, hint] = loadDocument.mock.calls[0];
    expect(hint).toBe('Refund-Policy.md');
    expect(ingestDocument).toHaveBeenCalledWith(
      'Refund-Policy.md',
      'refunds take five to seven days',
      expect.any(String),
      'md',
    );

    await fs.unlink(tmpFile).catch(() => undefined);
  });
});

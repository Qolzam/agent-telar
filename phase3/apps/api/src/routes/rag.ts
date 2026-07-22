import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import fs from 'fs/promises';
import { vectorStore } from '../services/vectorstore.service';
import { loadDocument } from '../services/loader.service';

export const ragRouter = Router();

const upload = multer({ dest: '/tmp/', limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/rag/ingest/file — upload PDF, DOCX, or plain text
ragRouter.post('/ingest/file', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const { content, type } = await loadDocument(req.file.path, req.file.originalname);
    res.json(await vectorStore.ingestDocument(req.file.originalname, content, req.file.path, type));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Ingest failed' });
  } finally {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => undefined);
    }
  }
});

// POST /api/rag/ingest/url — ingest a web page by URL
ragRouter.post('/ingest/url', async (req: Request, res: Response) => {
  try {
    const { url, name } = z.object({
      url: z.string().url(),
      name: z.string().optional(),
    }).parse(req.body);
    const { content } = await loadDocument(url);
    res.json(await vectorStore.ingestDocument(name ?? url, content, url, 'url'));
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: err.flatten() });
    } else {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Ingest failed' });
    }
  }
});

// GET /api/rag/search?q=... — hybrid search across ingested documents
ragRouter.get('/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '');
    if (!q) { res.status(400).json({ error: 'Query parameter q is required' }); return; }
    res.json({ query: q, results: await vectorStore.hybridSearch(q, 5) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Search failed' });
  }
});

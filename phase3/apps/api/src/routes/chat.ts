import { IRouter, Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { runAgentStream } from '../services/agent.service';
import { memoryService } from '../services/memory.service';

export const chatRouter: IRouter = Router();

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(10000),
  // Session ID is the user's identity in Phase 2.
  // In Phase 5 this gets replaced with JWT user ID.
  sessionId: z.string().uuid().optional(),
});

chatRouter.post('/', async (req: Request, res: Response) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const sessionId = parsed.data.sessionId ?? uuidv4();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Session-ID', sessionId);
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    for await (const agentEvent of runAgentStream(parsed.data.message, sessionId)) {
      sendEvent(agentEvent.type, {
        content: agentEvent.content,
        metadata: agentEvent.metadata,
        sessionId,
      });
    }
  } finally {
    res.end();
  }
});

// GET /api/chat/health
chatRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /api/chat/session/:sessionId/history
chatRouter.get('/session/:sessionId/history', async (req: Request, res: Response) => {
  const history = await memoryService.getHistory(req.params.sessionId);
  const tokens = await memoryService.getTokenEstimate(req.params.sessionId);
  res.json({ history, estimatedTokens: tokens, sessionId: req.params.sessionId });
});

// DELETE /api/chat/session/:sessionId
chatRouter.delete('/session/:sessionId', async (req: Request, res: Response) => {
  await memoryService.clearSession(req.params.sessionId);
  res.json({ message: 'Session cleared', sessionId: req.params.sessionId });
});

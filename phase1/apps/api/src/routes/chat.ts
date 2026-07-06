import { Router, Request, Response, IRouter } from 'express';
import { z } from 'zod';
import { streamChat, ChatMessage } from '../services/llm.service';

export const chatRouter: IRouter = Router();

// Request body validation schema
const ChatRequestSchema = z.object({
  message: z.string().min(1).max(10000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(50).default([]),
  temperature: z.number().min(0).max(2).optional(),
  systemPrompt: z.string().max(5000).optional(),
});

// POST /api/chat — streaming chat endpoint
chatRouter.post('/', async (req: Request, res: Response) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { message, history, temperature, systemPrompt } = parsed.data;

  // 2. Set SSE headers — this is what enables streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt ?? `You are AgentTelar, a helpful AI assistant.
Be concise, accurate, and professional.
Today is ${new Date().toISOString().split('T')[0]}.`,
      },
      ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content: message },
    ];

    let fullResponse = '';
    for await (const chunk of streamChat(messages, { temperature })) {
      if (chunk.done) {
        sendEvent('done', {
          fullResponse,
          usage: chunk.usage,
        });
      } else {
        fullResponse += chunk.text;
        sendEvent('token', { text: chunk.text });
      }
    }
  } catch (err) {
    sendEvent('error', {
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  } finally {
    res.end();
  }
});

// GET /api/chat/health — simple health check
chatRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

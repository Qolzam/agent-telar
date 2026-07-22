import Redis from 'ioredis';
import { env } from '../config/env';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolsUsed?: string[];
}

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('error', (err) => console.error('Redis error:', err));

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const MAX_HISTORY = 50;

export const memoryService = {
  async getHistory(sessionId: string): Promise<ConversationTurn[]> {
    const key = `session:${sessionId}:history`;
    const data = await redis.get(key);
    return data ? (JSON.parse(data) as ConversationTurn[]) : [];
  },

  async appendTurn(sessionId: string, turn: ConversationTurn): Promise<void> {
    const key = `session:${sessionId}:history`;
    const history = await this.getHistory(sessionId);
    history.push(turn);
    const trimmed = history.slice(-MAX_HISTORY);
    await redis.setex(key, SESSION_TTL, JSON.stringify(trimmed));
  },

  async clearSession(sessionId: string): Promise<void> {
    await redis.del(`session:${sessionId}:history`);
  },

  // Rough estimate: 1 token ≈ 4 chars
  async getTokenEstimate(sessionId: string): Promise<number> {
    const history = await this.getHistory(sessionId);
    const totalChars = history.reduce((acc, t) => acc + t.content.length, 0);
    return Math.round(totalChars / 4);
  },
};

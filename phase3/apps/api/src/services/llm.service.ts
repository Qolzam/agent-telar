import Groq from 'groq-sdk';
import { env } from '../config/env';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
}

export interface StreamChunk {
  text: string;
  done: boolean;
  usage?: LLMUsage;
}

// Singleton — instantiate once, reuse across requests
const groq = new Groq({ apiKey: env.GROQ_API_KEY });

// Groq pricing (USD per 1M tokens) — update if pricing changes
const PRICING: Record<string, { input: number; output: number }> = {
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model] ?? { input: 0.59, output: 0.79 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Streams a chat completion token-by-token via an async generator.
 * Yields a final chunk with `done: true` and usage/cost data.
 */
export async function* streamChat(
  messages: ChatMessage[],
  options: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
  } = {}
): AsyncGenerator<StreamChunk> {
  const model = options.model ?? env.GROQ_MODEL;

  const stream = await groq.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
    stream: true,
  });

  let promptTokens = 0;
  let completionTokens = 0;

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? '';
    const finishReason = chunk.choices[0]?.finish_reason;

    if (chunk.x_groq?.usage) {
      promptTokens = chunk.x_groq.usage.prompt_tokens;
      completionTokens = chunk.x_groq.usage.completion_tokens;
    }

    if (finishReason === 'stop') {
      yield {
        text: '',
        done: true,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          estimatedCostUSD: calculateCost(model, promptTokens, completionTokens),
        },
      };
    } else if (text) {
      yield { text, done: false };
    }
  }
}

/**
 * Non-streaming completion — for background jobs and evals.
 */
export async function completeChat(
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<{ text: string; usage: LLMUsage }> {
  const model = env.GROQ_MODEL;

  const response = await groq.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
    stream: false,
  });

  const text = response.choices[0]?.message?.content ?? '';
  const usage: LLMUsage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
    estimatedCostUSD: calculateCost(
      model,
      response.usage?.prompt_tokens ?? 0,
      response.usage?.completion_tokens ?? 0
    ),
  };

  return { text, usage };
}

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatGroq } from '@langchain/groq';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { env } from '../config/env';
import { AGENT_TOOLS } from '../tools';
import { memoryService } from './memory.service';

const model = new ChatGroq({
  apiKey: env.GROQ_API_KEY,
  model: env.GROQ_MODEL,
  temperature: 0.7,
  streaming: true,
});

const agent = createReactAgent({
  llm: model,
  tools: AGENT_TOOLS,
});

const SYSTEM_PROMPT = `You are AgentTelar, an intelligent AI assistant with access to tools.

TOOLS AVAILABLE:
- get_weather: Get weather for any city
- calculate: Evaluate math expressions
- search_wikipedia: Look up factual information
- get_current_datetime: Get current date/time
- search_knowledge_base: Search ingested company docs, policies, product info

RULES:
1. Use tools when you need current information or calculations — do not guess
2. Think step by step before acting
3. If a tool fails, acknowledge it and try an alternative approach
4. Be concise but thorough in your final answers
5. Always ground your answers in tool results when tools were used`;

export interface AgentStreamEvent {
  type: 'thought' | 'tool_call' | 'tool_result' | 'token' | 'done' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Runs the ReAct agent loop and yields SSE-ready events.
 * Persists each turn to Redis session memory.
 */
export async function* runAgentStream(
  userMessage: string,
  sessionId: string
): AsyncGenerator<AgentStreamEvent> {
  const history = await memoryService.getHistory(sessionId);

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    ...history.map((turn) =>
      turn.role === 'user'
        ? new HumanMessage(turn.content)
        : new AIMessage(turn.content)
    ),
    new HumanMessage(userMessage),
  ];

  const toolsUsed: string[] = [];
  let finalResponse = '';

  try {
    const stream = await agent.streamEvents({ messages }, { version: 'v2' });

    for await (const event of stream) {
      if (event.event === 'on_tool_start') {
        toolsUsed.push(event.name ?? '');
        yield {
          type: 'tool_call',
          content: `Using tool: ${event.name}`,
          metadata: { tool: event.name, input: event.data.input as unknown },
        };
      }

      if (event.event === 'on_tool_end') {
        yield {
          type: 'tool_result',
          content: 'Tool result received',
          metadata: { tool: event.name, output: event.data.output as unknown },
        };
      }

      if (
        event.event === 'on_chat_model_stream' &&
        typeof event.data?.chunk?.content === 'string' &&
        event.data.chunk.content
      ) {
        const token = event.data.chunk.content;
        finalResponse += token;
        yield { type: 'token', content: token };
      }
    }

    await memoryService.appendTurn(sessionId, {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });
    await memoryService.appendTurn(sessionId, {
      role: 'assistant',
      content: finalResponse,
      timestamp: Date.now(),
      toolsUsed,
    });

    yield { type: 'done', content: finalResponse, metadata: { toolsUsed } };
  } catch (err) {
    yield {
      type: 'error',
      content: err instanceof Error ? err.message : 'Agent error',
    };
  }
}

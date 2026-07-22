import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { vectorStore } from '../services/vectorstore.service';

// ─── Weather Tool ────────────────────────────────────────────────────────────

export const weatherTool = new DynamicStructuredTool({
  name: 'get_weather',
  description:
    'Get current weather and forecast for a city. Use when the user asks about weather, temperature, rain, or what to wear.',
  schema: z.object({
    city: z.string().describe('City name, e.g. Tokyo, New York, London'),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  func: async ({ city, units }) => {
    const format = units === 'celsius' ? 'm' : 'u';
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1&${format}`
    );
    if (!res.ok) return JSON.stringify({ error: `Could not get weather for ${city}` });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const current = data.current_condition[0];
    const tomorrow = data.weather[1];
    return JSON.stringify({
      city,
      temperature: `${current.temp_C}°C`,
      feelsLike: `${current.FeelsLikeC}°C`,
      description: current.weatherDesc[0].value,
      humidity: `${current.humidity}%`,
      tomorrow: {
        maxTemp: `${tomorrow.maxtempC}°C`,
        minTemp: `${tomorrow.mintempC}°C`,
        description: tomorrow.hourly[4].weatherDesc[0].value,
        chanceOfRain: `${tomorrow.hourly[4].chanceofrain}%`,
      },
    });
  },
});

// ─── Calculator Tool ─────────────────────────────────────────────────────────

export const calculatorTool = new DynamicStructuredTool({
  name: 'calculate',
  description:
    'Evaluate a mathematical expression. Use for any calculation, arithmetic, or math.',
  schema: z.object({
    expression: z
      .string()
      .describe('Math expression to evaluate, e.g. "(100 * 1.15) / 12"'),
  }),
  func: async ({ expression }) => {
    try {
      // Safe-ish eval via Function — replace with mathjs in production for full sandboxing
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const result = Function('return ' + expression)();
      if (typeof result !== 'number' || isNaN(result)) {
        return JSON.stringify({ error: 'Invalid expression' });
      }
      return JSON.stringify({ expression, result });
    } catch {
      return JSON.stringify({ error: 'Could not evaluate expression' });
    }
  },
});

// ─── Wikipedia Tool ──────────────────────────────────────────────────────────

export const wikipediaTool = new DynamicStructuredTool({
  name: 'search_wikipedia',
  description:
    'Search Wikipedia for factual information about a topic, person, place, or event.',
  schema: z.object({
    query: z
      .string()
      .describe('Search query, e.g. "LangChain framework" or "Eiffel Tower history"'),
  }),
  func: async ({ query }) => {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AgentTelar/2.0 (learning project)' },
    });
    if (!res.ok)
      return JSON.stringify({ error: `No Wikipedia article found for: ${query}` });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    return JSON.stringify({
      title: data.title,
      summary: data.extract?.slice(0, 1500),
      url: data.content_urls?.desktop?.page,
    });
  },
});

// ─── Current Date/Time Tool ──────────────────────────────────────────────────

export const dateTimeTool = new DynamicStructuredTool({
  name: 'get_current_datetime',
  description: 'Get the current date and time. Use when user asks what time or date it is.',
  schema: z.object({
    timezone: z
      .string()
      .default('UTC')
      .describe('Timezone, e.g. America/New_York, Asia/Tokyo'),
  }),
  func: async ({ timezone }) => {
    const now = new Date();
    return JSON.stringify({
      utc: now.toISOString(),
      local: now.toLocaleString('en-US', { timeZone: timezone }),
      timezone,
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone }),
    });
  },
});

// ─── Knowledge Base Tool ─────────────────────────────────────────────────────

export const knowledgeBaseTool = new DynamicStructuredTool({
  name: 'search_knowledge_base',
  description:
    'Search company docs, policies, product info, and internal knowledge. Use when the user asks about ingested documents or internal information.',
  schema: z.object({
    query: z.string().describe('What to search for in the knowledge base'),
  }),
  func: async ({ query }) => {
    const results = await vectorStore.hybridSearch(query, 4);
    if (!results.length) return JSON.stringify({ found: false });
    return JSON.stringify({
      found: true,
      sources: results.map(r => ({
        content: r.content,
        source: r.doc_name,
        relevance: (Number(r.score) * 100).toFixed(1) + '%',
      })),
    });
  },
});

export const AGENT_TOOLS = [weatherTool, calculatorTool, wikipediaTool, dateTimeTool, knowledgeBaseTool];

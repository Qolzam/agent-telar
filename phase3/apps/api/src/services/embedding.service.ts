import { OpenAIEmbeddings } from '@langchain/openai';
import { env } from '../config/env';

const embeddings = new OpenAIEmbeddings({
  apiKey: env.OPENAI_API_KEY,
  model: env.EMBEDDING_MODEL, // text-embedding-3-small — $0.02/1M tokens
});

export const embedQuery = (text: string): Promise<number[]> =>
  embeddings.embedQuery(text);

export async function embedChunks(texts: string[]): Promise<number[][]> {
  const BATCH = 100;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    results.push(...await embeddings.embedDocuments(texts.slice(i, i + BATCH)));
    // Avoid rate-limit spikes on large batches
    if (i + BATCH < texts.length) await new Promise(r => setTimeout(r, 100));
  }
  return results;
}

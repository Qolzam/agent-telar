import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import { assertSafeUrl } from '../lib/url-safety';
import { resolveDocumentExt } from '../lib/document-ext';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readResponseText(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf-8') > maxBytes) {
      throw new Error('Response too large');
    }
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch(() => undefined);
        throw new Error('Response too large');
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
}

export async function loadDocument(
  source: string,
  filenameHint?: string,
): Promise<{ content: string; type: string }> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const url = await assertSafeUrl(source);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'AgentTelar/3.0' },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`Failed to fetch URL (${res.status})`);
      const html = await readResponseText(res, MAX_RESPONSE_BYTES);
      const $ = cheerio.load(html);
      $('script,style,nav,footer,header').remove();
      return {
        content: $('main,article,body').first().text().replace(/\s+/g, ' ').trim(),
        type: 'url',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const ext = resolveDocumentExt(source, filenameHint);
  if (ext === '.pdf') {
    const buf = await fs.readFile(source);
    return { content: (await pdfParse(buf)).text, type: 'pdf' };
  }
  if (ext === '.docx') {
    const r = await mammoth.extractRawText({ path: source });
    return { content: r.value, type: 'docx' };
  }
  return {
    content: await fs.readFile(source, 'utf-8'),
    type: ext.slice(1) || 'text',
  };
}

import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as cheerio from 'cheerio';

export async function loadDocument(source: string): Promise<{ content: string; type: string }> {
  if (source.startsWith('http')) {
    const res = await fetch(source, { headers: { 'User-Agent': 'AgentTelar/3.0' } });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script,style,nav,footer,header').remove();
    return {
      content: $('main,article,body').first().text().replace(/\s+/g, ' ').trim(),
      type: 'url',
    };
  }
  const ext = path.extname(source).toLowerCase();
  if (ext === '.pdf') {
    const buf = await fs.readFile(source);
    return { content: (await pdfParse(buf)).text, type: 'pdf' };
  }
  if (ext === '.docx') {
    const r = await mammoth.extractRawText({ path: source });
    return { content: r.value, type: 'docx' };
  }
  return { content: await fs.readFile(source, 'utf-8'), type: ext.slice(1) || 'text' };
}

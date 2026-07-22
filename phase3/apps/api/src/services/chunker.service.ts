export interface TextChunk {
  content: string;
  index: number;
  metadata: { startChar: number; endChar: number; wordCount: number };
}

export function chunkText(text: string, size = 512, overlap = 50): TextChunk[] {
  const separators = ['\n\n', '\n', '. ', '! ', '? ', ' '];
  const chunks: string[] = [];

  function split(txt: string, seps: string[]): void {
    if (txt.length <= size) { if (txt.trim()) chunks.push(txt.trim()); return; }
    const [sep, ...rest] = seps;
    if (sep === undefined) { chunks.push(txt.slice(0, size)); return; }
    const parts = txt.split(sep);
    let cur = '';
    for (const part of parts) {
      const candidate = cur ? cur + sep + part : part;
      if (candidate.length <= size) { cur = candidate; }
      else {
        if (cur) { chunks.push(cur.trim()); cur = cur.slice(-overlap) + sep + part; }
        else split(part, rest);
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
  }

  split(text, separators);
  let pos = 0;
  return chunks.map((content, index) => {
    const startChar = text.indexOf(content, pos);
    pos = startChar + content.length;
    return { content, index, metadata: { startChar, endChar: pos, wordCount: content.split(/\s+/).length } };
  });
}

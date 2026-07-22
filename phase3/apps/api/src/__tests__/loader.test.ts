import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'dns/promises';
import { assertSafeUrl, isPrivateIp } from '../lib/url-safety';
import { resolveDocumentExt } from '../lib/document-ext';

describe('resolveDocumentExt', () => {
  it('prefers filenameHint when the temp path has no extension', () => {
    expect(resolveDocumentExt('/tmp/abcdef', 'Refund-Policy.md')).toBe('.md');
    expect(resolveDocumentExt('/tmp/abcdef', 'handbook.pdf')).toBe('.pdf');
  });

  it('falls back to the source path extension', () => {
    expect(resolveDocumentExt('/data/notes.txt')).toBe('.txt');
  });
});

describe('isPrivateIp', () => {
  it('flags common private and loopback ranges', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.0.0.5')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects private literal hosts and localhost', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/secret')).rejects.toThrow(/not allowed/);
    await expect(assertSafeUrl('http://localhost/secret')).rejects.toThrow(/not allowed/);
  });

  it('rejects hosts that resolve to private addresses', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
    ] as never);
    await expect(assertSafeUrl('http://evil.example/docs')).rejects.toThrow(/not allowed/);
  });

  it('allows public resolved hosts', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
    const url = await assertSafeUrl('https://example.com/page');
    expect(url.hostname).toBe('example.com');
  });
});

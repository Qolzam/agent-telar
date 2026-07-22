import dns from 'dns/promises';
import net from 'net';

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    if (normalized.startsWith('::ffff:')) {
      return isPrivateIp(normalized.slice(7));
    }
  }
  return false;
}

/** Validate http(s) URL and block localhost / private resolved addresses. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new Error('URL host is not allowed');
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('URL host is not allowed');
    return url;
  }
  const lookups = await dns.lookup(hostname, { all: true });
  if (!lookups.length) throw new Error('Could not resolve URL host');
  for (const { address } of lookups) {
    if (isPrivateIp(address)) throw new Error('URL host is not allowed');
  }
  return url;
}

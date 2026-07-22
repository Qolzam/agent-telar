/** Whitelist-only arithmetic: digits, + - * / ( ) . and whitespace. */
const SAFE_EXPR = /^[\d\s+\-*/().]+$/;

/**
 * Evaluate a simple arithmetic expression without Function/eval.
 * Supports + - * / and parentheses with standard precedence.
 */
export function evaluateSafeMath(expression: string): number {
  const trimmed = expression.trim();
  if (!trimmed || !SAFE_EXPR.test(trimmed)) {
    throw new Error('Expression contains disallowed characters');
  }

  let i = 0;
  const s = trimmed;

  function skipWs() {
    while (i < s.length && /\s/.test(s[i])) i++;
  }

  function parseNumber(): number {
    skipWs();
    const start = i;
    if (s[i] === '+' || s[i] === '-') i++;
    let sawDigit = false;
    while (i < s.length && /\d/.test(s[i])) {
      sawDigit = true;
      i++;
    }
    if (i < s.length && s[i] === '.') {
      i++;
      while (i < s.length && /\d/.test(s[i])) {
        sawDigit = true;
        i++;
      }
    }
    if (!sawDigit) throw new Error('Invalid expression');
    const n = Number(s.slice(start, i));
    if (!Number.isFinite(n)) throw new Error('Invalid expression');
    return n;
  }

  function parseFactor(): number {
    skipWs();
    if (s[i] === '(') {
      i++;
      const v = parseExpr();
      skipWs();
      if (s[i] !== ')') throw new Error('Invalid expression');
      i++;
      return v;
    }
    if (s[i] === '+' || s[i] === '-') {
      const sign = s[i] === '-' ? -1 : 1;
      i++;
      return sign * parseFactor();
    }
    return parseNumber();
  }

  function parseTerm(): number {
    let v = parseFactor();
    while (true) {
      skipWs();
      if (s[i] === '*') {
        i++;
        v *= parseFactor();
      } else if (s[i] === '/') {
        i++;
        const d = parseFactor();
        if (d === 0) throw new Error('Division by zero');
        v /= d;
      } else {
        break;
      }
    }
    return v;
  }

  function parseExpr(): number {
    let v = parseTerm();
    while (true) {
      skipWs();
      if (s[i] === '+') {
        i++;
        v += parseTerm();
      } else if (s[i] === '-') {
        i++;
        v -= parseTerm();
      } else {
        break;
      }
    }
    return v;
  }

  const result = parseExpr();
  skipWs();
  if (i !== s.length) throw new Error('Invalid expression');
  if (!Number.isFinite(result)) throw new Error('Invalid expression');
  return result;
}

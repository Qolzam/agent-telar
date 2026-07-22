import { describe, it, expect } from 'vitest';
import { evaluateSafeMath } from '../lib/safe-math';

describe('evaluateSafeMath', () => {
  it('evaluates arithmetic with precedence', () => {
    expect(evaluateSafeMath('2+3*4')).toBe(14);
    expect(evaluateSafeMath('(100 * 1.15) / 12')).toBeCloseTo(9.583333, 5);
  });

  it('supports unary minus', () => {
    expect(evaluateSafeMath('-5 + 2')).toBe(-3);
  });

  it('rejects disallowed characters and code injection', () => {
    expect(() => evaluateSafeMath('process.exit(1)')).toThrow();
    expect(() => evaluateSafeMath('require("fs")')).toThrow();
    expect(() => evaluateSafeMath('1; console.log(1)')).toThrow();
    expect(() => evaluateSafeMath('2 ** 3')).toThrow();
  });

  it('rejects empty and incomplete expressions', () => {
    expect(() => evaluateSafeMath('')).toThrow();
    expect(() => evaluateSafeMath('((1+2)')).toThrow();
  });
});

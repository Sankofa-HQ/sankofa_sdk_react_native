/**
 * coerceConfigValue — Config read parity tests.
 *
 * Pins the cross-type coercion that brings RN's Config reads in line with
 * the Flutter / Android / iOS SDKs: a server `bool` that arrives over JSON
 * as a number (1/0) or string ("true"/"false") must still read back as a
 * boolean, and an incompatible value must fall through to the caller's
 * default rather than being handed back wrong-typed.
 */

import { coerceConfigValue } from '../src/config/coerce';

describe('coerceConfigValue', () => {
  test('same-type values pass through untouched', () => {
    expect(coerceConfigValue('hi', 'default')).toBe('hi');
    expect(coerceConfigValue(42, 0)).toBe(42);
    expect(coerceConfigValue(3.14, 0)).toBe(3.14);
    expect(coerceConfigValue(true, false)).toBe(true);
    expect(coerceConfigValue({ a: 1 }, {})).toEqual({ a: 1 });
    expect(coerceConfigValue([1, 2], [])).toEqual([1, 2]);
  });

  test('bool default coerces number encodings', () => {
    expect(coerceConfigValue(1, false)).toBe(true);
    expect(coerceConfigValue(0, true)).toBe(false);
    expect(coerceConfigValue(2, false)).toBe(true); // any non-zero is truthy
  });

  test('bool default coerces string encodings', () => {
    expect(coerceConfigValue('true', false)).toBe(true);
    expect(coerceConfigValue('TRUE', false)).toBe(true);
    expect(coerceConfigValue('1', false)).toBe(true);
    expect(coerceConfigValue('false', true)).toBe(false);
    expect(coerceConfigValue('0', true)).toBe(false);
    expect(coerceConfigValue(' True ', false)).toBe(true); // trimmed
  });

  test('bool default rejects un-coercible strings → default', () => {
    expect(coerceConfigValue('maybe', false)).toBe(false);
    expect(coerceConfigValue('yes', true)).toBe(true); // not a recognised token → default
  });

  test('null / undefined value → default', () => {
    expect(coerceConfigValue(null, 'fallback')).toBe('fallback');
    expect(coerceConfigValue(undefined, 7)).toBe(7);
  });

  test('incompatible types fall through to default (no wrong-typed return)', () => {
    expect(coerceConfigValue('hello', 0)).toBe(0); // string → number default
    expect(coerceConfigValue(42, 'x')).toBe('x'); // number → string default
    expect(coerceConfigValue('42', 0)).toBe(0); // numeric string is NOT coerced (matches Flutter/Android)
    expect(coerceConfigValue(true, 0)).toBe(0); // bool → number default
  });

  test('array vs plain-object are kept distinct', () => {
    // typeof both === "object", but [] and {} must not cross over.
    expect(coerceConfigValue({ a: 1 }, [])).toEqual([]); // object → array default
    expect(coerceConfigValue([1], {})).toEqual({}); // array → object default
  });
});

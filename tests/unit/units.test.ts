import { describe, expect, it } from 'vitest';
import {
  metersToMm,
  mmToMeters,
  mmToPx,
  pxToMm,
} from '../../src/geometry/units';

describe('length units', () => {
  it.each([0, 1, -20, 15040, 0.001, 123456.78])(
    'round trips %s through pixels and metres',
    (value) => {
      for (const scale of [1, 0.1, 15.537190082644628]) {
        expect(mmToPx(pxToMm(value, scale), scale)).toBeCloseTo(value, 8);
        expect(pxToMm(mmToPx(value, scale), scale)).toBeCloseTo(value, 8);
      }
      expect(metersToMm(mmToMeters(value))).toBeCloseTo(value, 8);
    },
  );
  it('converts the scene convention of 1 unit = 1 metre', () => {
    expect(mmToMeters(2800)).toBe(2.8);
    expect(metersToMm(0.24)).toBe(240);
    expect(pxToMm(968, 15040 / 968)).toBe(15040);
  });
  it.each([0, -1, Infinity, NaN])(
    'rejects invalid mm-per-pixel ratios: %s',
    (scale) => {
      expect(() => pxToMm(1, scale)).toThrow('比例尺');
      expect(() => mmToPx(1, scale)).toThrow('比例尺');
    },
  );
  it.each([Infinity, -Infinity, NaN])(
    'rejects non-finite lengths: %s',
    (value) => {
      expect(() => pxToMm(value, 1)).toThrow();
      expect(() => mmToPx(value, 1)).toThrow();
      expect(() => mmToMeters(value)).toThrow();
      expect(() => metersToMm(value)).toThrow();
    },
  );
});

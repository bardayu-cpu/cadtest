import { afterEach, expect, it, vi } from 'vitest';
import {
  calibrationIdentity,
  readEditorUiSettings,
  saveEditorUiSettings,
} from '../../src/editor2d/ui-settings';

afterEach(() => vi.unstubAllGlobals());
it('persists lock and calibration markers per project, without storing image pixels', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const source = 'data:image/png;base64,private-image-pixels';
  const marker = calibrationIdentity(source, 1);
  expect(readEditorUiSettings('a')).toEqual({ locked: true, calibrations: [] });
  saveEditorUiSettings('a', { locked: false, calibrations: [marker] });
  expect(readEditorUiSettings('a')).toEqual({
    locked: false,
    calibrations: [marker],
  });
  expect(readEditorUiSettings('b')).toEqual({ locked: true, calibrations: [] });
  expect(Array.from(values.values()).join()).not.toContain(
    'private-image-pixels',
  );
  expect(calibrationIdentity(source, 2)).not.toBe(marker);
  expect(calibrationIdentity(source + 'other', 1)).not.toBe(marker);
});
it('falls back safely if browser UI storage is unavailable or corrupted', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => '{broken',
    setItem: () => {
      throw new Error('quota');
    },
  });
  expect(readEditorUiSettings('a')).toEqual({ locked: true, calibrations: [] });
  expect(() =>
    saveEditorUiSettings('a', { locked: false, calibrations: [] }),
  ).not.toThrow();
});

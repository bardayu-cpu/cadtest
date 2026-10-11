import { describe, expect, it } from 'vitest';
import { getHistoryShortcut, type HistoryKey } from '../../src/model/shortcuts';

const base: HistoryKey = {
  key: 'z',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
  defaultPrevented: false,
};
describe('history shortcuts', () => {
  it.each(['ctrlKey', 'metaKey'] as const)(
    'supports undo and shift-redo with %s',
    (modifier) => {
      expect(getHistoryShortcut({ ...base, [modifier]: true })).toBe('undo');
      expect(
        getHistoryShortcut({
          ...base,
          key: 'Z',
          [modifier]: true,
          shiftKey: true,
        }),
      ).toBe('redo');
    },
  );
  it('preserves native text editing, composition and handled events', () => {
    const event = { ...base, ctrlKey: true };
    expect(getHistoryShortcut(event, true)).toBeNull();
    expect(getHistoryShortcut({ ...event, isComposing: true })).toBeNull();
    expect(getHistoryShortcut({ ...event, defaultPrevented: true })).toBeNull();
    expect(getHistoryShortcut({ ...event, altKey: true })).toBeNull();
    expect(getHistoryShortcut(base)).toBeNull();
    expect(getHistoryShortcut({ ...event, key: 'y' })).toBeNull();
  });
});

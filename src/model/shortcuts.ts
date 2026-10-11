export interface HistoryKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
}

export function getHistoryShortcut(event: HistoryKey, editingText = false) {
  if (
    editingText ||
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    !(event.ctrlKey || event.metaKey) ||
    event.key.toLowerCase() !== 'z'
  )
    return null;
  return event.shiftKey ? 'redo' : 'undo';
}

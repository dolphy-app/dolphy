/** Ctrl/⌘+K без других модификаторов; раскладка не важна (`KeyK` или `k`). */
export const isPaletteShortcut = (
  event: Pick<
    KeyboardEvent,
    'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code' | 'key'
  >,
): boolean =>
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !event.shiftKey &&
  (event.code === 'KeyK' || event.key.toLowerCase() === 'k');

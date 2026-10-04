/** Клавиша `Mod` окна в Playwright: ⌘ на macOS, Ctrl на остальных (`Mod` строгий, Ctrl+K на macOS палитру не открывает). */
export const MOD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Подпись `Mod` в окне. */
export const MOD_LABEL = process.platform === 'darwin' ? '⌘' : 'Ctrl+';

/** Как `Mod` озвучивается скринридеру. */
export const MOD_WORD = process.platform === 'darwin' ? 'Command' : 'Control';

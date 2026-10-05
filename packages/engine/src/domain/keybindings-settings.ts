import type { KeybindingsSettingsDto } from '@dolphy-app/engine-contract';
import { decodeUserKeybindings } from '@dolphy-app/keybindings';

/** Без сохранённых привязок пользователя действуют привязки из кода и расширений. */
export const DEFAULT_KEYBINDINGS_SETTINGS: Readonly<KeybindingsSettingsDto> =
  Object.freeze({ commands: Object.freeze({}) });

/**
 * Хранимое значение → настройки. Терпимо к мусору (R15): команды с неверным
 * ключом и записи неверной формы отбрасываются, остальные действуют; разбор
 * клавиш и условий отложен до проверки при сохранении и до сборки карты.
 */
export const decodeKeybindingsSettings = (
  raw: unknown,
): KeybindingsSettingsDto => {
  const commands: KeybindingsSettingsDto['commands'] = {};
  for (const [command, entries] of Object.entries(decodeUserKeybindings(raw))) {
    commands[command] = entries.map(({ key, when }) => ({ key, when }));
  }
  return { commands };
};

export {
  COMMAND_KEY_PATTERN,
  KEYBINDING_LIMITS,
  KEY_MAX_LENGTH,
  WHEN_MAX_LENGTH,
} from '@dolphy-app/keybindings';

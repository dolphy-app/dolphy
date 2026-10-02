export { isPaletteShortcut } from './lib/shortcut.ts';
export {
  createExtensionCommands,
  EXTENSION_COMMANDS_KEY,
  useExtensionCommands,
} from './model/extension-commands.ts';
export type { ExtensionCommands } from './model/extension-commands.ts';
export { panelKey } from './model/panel-props.ts';
export { default as NoticeSnackbar } from './ui/NoticeSnackbar.vue';
export { messages as extensionCommandsMessages } from './i18n';

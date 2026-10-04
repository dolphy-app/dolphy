export { describeCommandFailure } from './lib/failure.ts';
export {
  createExtensionCommands,
  EXTENSION_COMMANDS_KEY,
  useExtensionCommands,
} from './model/extension-commands.ts';
export { extensionCommandKey } from './model/registry-adapter.ts';
export type { ExtensionCommands } from './model/extension-commands.ts';
export { panelKey } from './model/panel-props.ts';
export { default as NoticeSnackbar } from './ui/NoticeSnackbar.vue';
export { messages as extensionCommandsMessages } from './i18n';

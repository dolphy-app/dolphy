export { default as CommandPalette } from './ui/CommandPalette.vue';
export {
  COMMAND_PALETTE_KEY,
  createCommandPalette,
  useCommandPalette,
} from './model/palette.ts';
export type { CommandPalette as CommandPaletteModel } from './model/palette.ts';
export { messages as commandPaletteMessages } from './i18n';

export { detectPlatform, PLATFORMS, platformFromNode } from './platform.ts';
export type { Platform } from './platform.ts';
export {
  chordStartsWith,
  chordToText,
  codeToKey,
  eventToKeystroke,
  formatChord,
  isTypingChord,
  KeybindingSyntaxError,
  matchKeystroke,
  MAX_CHORD_LENGTH,
  parseChord,
  spokenChord,
  strokeKey,
  tryParseChord,
} from './keystroke.ts';
export type {
  Chord,
  KeyEventLike,
  Keystroke,
  SpokenId,
  SyntaxReason,
} from './keystroke.ts';
export {
  evaluateWhen,
  parseWhen,
  tryParseWhen,
  WHEN_MAX_LENGTH,
  whenOverlaps,
  WhenSyntaxError,
  whenToText,
} from './when.ts';
export type { ContextLookup, WhenExpr, WhenReason } from './when.ts';
export { buildKeymap, findCandidateConflicts } from './keymap.ts';
export type {
  Binding,
  BindingDefinition,
  BindingIssue,
  BindingSource,
  Candidate,
  Conflict,
  Keymap,
  KeymapInput,
  Resolution,
  UserBindingEntry,
  UserKeybindings,
} from './keymap.ts';
export { KEY_MAX_LENGTH, validateBinding } from './validate.ts';
export type { BindingProblem } from './validate.ts';
export {
  COMMAND_KEY_PATTERN,
  decodeUserKeybindings,
  KEYBINDING_LIMITS,
  validateUserKeybindings,
} from './user.ts';
export type { UserIssue, UserIssueReason } from './user.ts';

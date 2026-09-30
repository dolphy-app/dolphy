export * from '@spirula/extension-api';
export {
  defineExerciseType,
  defineExtension,
  type ExtensionDefinition,
} from './define-extension.ts';
export {
  defineAnswerElement,
  type AnswerElementApi,
  type AnswerElementInstance,
  type MountAnswerElement,
} from './answer-element.ts';
export { defineMarkdownRenderer } from './markdown-renderer.ts';

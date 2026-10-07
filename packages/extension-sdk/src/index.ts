export * from '@dolphy-app/extension-api';
export { notify, openPanel } from './commands.ts';
export {
  defineClient,
  defineExerciseType,
  defineServer,
  type ClientContext,
  type InjectionRegistration,
  type ClientEntry,
  type PanelRegistration,
} from './define-entry.ts';

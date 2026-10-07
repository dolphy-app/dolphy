export * from '@dolphy-app/extension-api';
export type { ExtensionEngine } from '@dolphy-app/engine-contract';
export { notify, openPanel } from './commands.ts';
export {
  defineClient,
  defineExerciseType,
  defineServer,
  type AppApi,
  type ClientContext,
  type InjectionRegistration,
  type ClientEntry,
  type PanelRegistration,
  type ServerContext,
  type ServerEntry,
} from './define-entry.ts';
export { defineRpc } from './rpc.ts';

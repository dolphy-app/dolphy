import type { InjectionKey } from 'vue';
import type { LearningEngine } from '@dolphy-app/engine-contract';
import type { ContributionsRef } from './contributions.ts';
import type { ExtensionUpdates } from './extension-updates.ts';
import type { LocaleSelection } from './locale-selection.ts';
import type { ThemeSelection } from './theme-selection.ts';

export const ENGINE_KEY: InjectionKey<LearningEngine> = Symbol('engine');
export const CONTRIBUTIONS_KEY: InjectionKey<ContributionsRef> =
  Symbol('contributions');
export const EXTENSION_UPDATES_KEY: InjectionKey<ExtensionUpdates> =
  Symbol('extension-updates');
export const THEME_SELECTION_KEY: InjectionKey<ThemeSelection> =
  Symbol('theme-selection');
export const LOCALE_SELECTION_KEY: InjectionKey<LocaleSelection> =
  Symbol('locale-selection');

import { en as vuetifyEn, ru as vuetifyRu } from 'vuetify/locale';
import { coursesMessages } from '@/pages/courses';
import { dailyPlanMessages } from '@/pages/daily-plan';
import { extensionPanelMessages } from '@/pages/extension-panel';
import { graphMessages } from '@/pages/graph';
import { placementMessages } from '@/pages/placement';
import { sessionMessages } from '@/pages/session';
import { settingsMessages } from '@/pages/settings';
import { repositoryMessages } from '@/entities/repository';
import { appCommandsMessages } from '@/features/app-commands';
import { courseScopeMessages } from '@/features/course-scope';
import { extensionCommandsMessages } from '@/features/extension-commands';
import { keybindingsMessages } from '@/features/keybindings';
import { sharedMessages } from '@/shared/i18n';
import { commandPaletteMessages } from '@/widgets/command-palette';
import { exercisePanelMessages } from '@/widgets/exercise-panel';
import { extensionWidgetsMessages } from '@/widgets/extension-widgets';
import { en as appEn } from './en.ts';
import { ru as appRu } from './ru.ts';

/** Схема ключей: каталог `ru` — источник истины, `en` обязан ему соответствовать. */
export const appMessages = {
  ru: {
    ...sharedMessages.ru,
    ...appRu,
    ...appCommandsMessages.ru,
    ...courseScopeMessages.ru,
    ...extensionCommandsMessages.ru,
    ...keybindingsMessages.ru,
    ...repositoryMessages.ru,
    ...coursesMessages.ru,
    ...commandPaletteMessages.ru,
    ...dailyPlanMessages.ru,
    ...extensionPanelMessages.ru,
    ...exercisePanelMessages.ru,
    ...extensionWidgetsMessages.ru,
    ...graphMessages.ru,
    ...placementMessages.ru,
    ...sessionMessages.ru,
    ...settingsMessages.ru,
  },
  en: {
    ...sharedMessages.en,
    ...appEn,
    ...appCommandsMessages.en,
    ...courseScopeMessages.en,
    ...extensionCommandsMessages.en,
    ...keybindingsMessages.en,
    ...repositoryMessages.en,
    ...coursesMessages.en,
    ...commandPaletteMessages.en,
    ...dailyPlanMessages.en,
    ...extensionPanelMessages.en,
    ...exercisePanelMessages.en,
    ...extensionWidgetsMessages.en,
    ...graphMessages.en,
    ...placementMessages.en,
    ...sessionMessages.en,
    ...settingsMessages.en,
  },
};

export type MessageSchema = typeof appMessages.ru;

/** Каталог для vue-i18n: свои сообщения плюс `$vuetify` для встроенных строк Vuetify. */
export const messages = {
  ru: { ...appMessages.ru, $vuetify: vuetifyRu },
  en: { ...appMessages.en, $vuetify: vuetifyEn },
};

/** Именованные форматы дат: одинаковые параметры, язык подставляет vue-i18n. */
const fullDate: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

const shortDate: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

const shortDateTime: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const shortTime: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
};

export const datetimeFormats = {
  ru: { fullDate, shortDate, shortDateTime, shortTime },
  en: { fullDate, shortDate, shortDateTime, shortTime },
};

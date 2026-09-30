import type { MessageSchema } from './messages.ts';

declare module 'vue-i18n' {
  // ключи `t()` проверяются по каталогу `ru`
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface DefineLocaleMessage extends MessageSchema {}
  interface DefineDateTimeFormat {
    fullDate: Intl.DateTimeFormatOptions;
    shortDateTime: Intl.DateTimeFormatOptions;
  }
}

import { shallowRef } from 'vue';
import type { Ref } from 'vue';
import type { AppNotifyKind } from '@dolphy-app/extension-api';
import type { CommandFailure } from '../lib/failure.ts';

/** Уведомление приложения: текст расширения или сбой команды (текст собирает компонент). */
export type Notice =
  | { kind: 'notify'; text: string; level?: AppNotifyKind }
  | { kind: 'failure'; failure: CommandFailure };

export interface NoticeEntry {
  /** Растёт с каждым уведомлением: одинаковый текст подряд показывается заново. */
  id: number;
  notice: Notice;
}

export interface Notices {
  readonly current: Readonly<Ref<NoticeEntry | null>>;
  /** Показывает уведомление; предыдущее заменяется. */
  push(notice: Notice): void;
  /** Убирает уведомление `id`; более новое остаётся. */
  dismiss(id: number): void;
}

/** Хранилище единственного видимого уведомления приложения. */
export const createNotices = (): Notices => {
  const current = shallowRef<NoticeEntry | null>(null);
  let counter = 0;
  return {
    current,
    push: (notice) => {
      counter += 1;
      current.value = { id: counter, notice };
    },
    dismiss: (id) => {
      if (current.value?.id === id) current.value = null;
    },
  };
};

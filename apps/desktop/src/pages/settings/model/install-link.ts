import type {
  CatalogEntryDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { toEngineError } from '@/entities/repository';
import { entryAction, targetFromEntry } from '../lib/catalog.ts';
import type { InstallTarget } from '../lib/catalog.ts';
import type { ExtensionInstall } from './install.ts';

/** Чем кончилась ссылка `dolphy://extensions/install/<id>` для записи каталога. */
export type InstallLinkOutcome =
  /** Диалог установки (или обновления) с подтверждением кнопкой. */
  | { kind: 'review'; target: InstallTarget }
  | { kind: 'not-found'; id: string }
  | { kind: 'up-to-date'; name: string; version: string }
  /** Расширение с этим id есть, но не из этого каталога. */
  | { kind: 'elsewhere'; name: string }
  /** Несовместимое: причину показывает страница расширения. */
  | { kind: 'incompatible'; id: string; name: string; detail: string };

/**
 * Что делать со ссылкой установки по записи каталога. Установка никогда не
 * начинается отсюда: `review` лишь открывает диалог.
 */
export const resolveInstallLink = (
  entries: readonly CatalogEntryDto[],
  id: string,
): InstallLinkOutcome => {
  const entry = entries.find((item) => item.id === id);
  if (entry === undefined) return { kind: 'not-found', id };
  const action = entryAction(entry);
  if (action.kind === 'install' || action.kind === 'update') {
    return { kind: 'review', target: targetFromEntry(entry, action.version) };
  }
  if (action.kind === 'installed') {
    return { kind: 'up-to-date', name: entry.name, version: action.version };
  }
  if (action.kind === 'elsewhere')
    return { kind: 'elsewhere', name: entry.name };
  return {
    kind: 'incompatible',
    id: entry.id,
    name: entry.name,
    detail: action.detail,
  };
};

/** Сообщение окна о ссылке: ключ `settings.extensions.link.<key>` и подстановки. */
export interface InstallLinkMessage {
  key:
    'busy' | 'notFound' | 'upToDate' | 'elsewhere' | 'incompatible' | 'failed';
  params: Record<string, string>;
}

export interface InstallLinksDeps {
  engine: LearningEngine;
  install: Pick<ExtensionInstall, 'phase' | 'review'>;
  notify(message: InstallLinkMessage): void;
  /** Открывает страницу расширения (несовместимое: причина — на странице). */
  openPage(id: string): void;
}

export interface InstallLinks {
  /** Ведёт принятую ссылку; результат — диалог или сообщение, установка — только после «Установить». */
  handle(id: string): Promise<void>;
}

/**
 * Обработка ссылок установки в окне. Запись каталога запрашивается при
 * необходимости (`extensions.catalog` отдаёт сохранённый индекс, пока он
 * свежий). Пока идёт установка, ссылка отбрасывается с сообщением; если
 * пришла новая ссылка, пока читался каталог, ведётся только она.
 */
export const createInstallLinks = ({
  engine,
  install,
  notify,
  openPage,
}: InstallLinksDeps): InstallLinks => {
  let latest = 0;

  const busy = () => {
    if (install.phase.value !== 'running') return false;
    notify({ key: 'busy', params: {} });
    return true;
  };

  const handle = async (id: string) => {
    if (busy()) return;
    latest += 1;
    const request = latest;
    let entries: readonly CatalogEntryDto[];
    try {
      entries = (await engine.extensions.catalog()).entries;
    } catch (caught) {
      if (request === latest) {
        notify({
          key: 'failed',
          params: { message: toEngineError(caught).message },
        });
      }
      return;
    }
    // установка могла начаться, пока читался каталог
    if (request !== latest || busy()) return;
    const outcome = resolveInstallLink(entries, id);
    switch (outcome.kind) {
      case 'review':
        install.review([outcome.target]);
        return;
      case 'not-found':
        notify({ key: 'notFound', params: { id: outcome.id } });
        return;
      case 'up-to-date':
        notify({
          key: 'upToDate',
          params: { name: outcome.name, version: outcome.version },
        });
        return;
      case 'elsewhere':
        notify({ key: 'elsewhere', params: { name: outcome.name } });
        return;
      case 'incompatible':
        notify({
          key: 'incompatible',
          params: { name: outcome.name, detail: outcome.detail },
        });
        openPage(outcome.id);
    }
  };

  return { handle };
};

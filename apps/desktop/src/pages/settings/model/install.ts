import { computed, inject, ref, shallowRef } from 'vue';
import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue';
import type { LearningEngine } from '@dolphy-app/engine-contract';
import { toEngineError } from '@/entities/repository';
import type { InstallTarget } from '../lib/catalog.ts';
import { describeInstallFailure } from '../lib/install-error.ts';
import type { InstallFailure } from '../lib/install-error.ts';

/** `confirm` — диалог перед установкой, `running` — идёт загрузка, `finished` — итог по каждому расширению. */
export type InstallPhase = 'idle' | 'confirm' | 'running' | 'finished';

export type InstallItemStatus = 'pending' | 'running' | 'done' | 'failed';

export interface InstallItem {
  target: InstallTarget;
  status: InstallItemStatus;
  failure: InstallFailure | null;
}

const isRunnable = (item: InstallItem) =>
  item.status === 'pending' || item.status === 'failed';

export interface ExtensionInstall {
  phase: Ref<InstallPhase>;
  items: ShallowRef<InstallItem[]>;
  succeeded: ComputedRef<boolean>;
  failed: ComputedRef<InstallItem[]>;
  canRetry: ComputedRef<boolean>;
  removing: Ref<string | null>;
  removeError: Ref<string | null>;
  review(targets: readonly InstallTarget[]): void;
  dismiss(): void;
  confirm(): Promise<void>;
  retry(): Promise<void>;
  remove(id: string, removeData?: boolean): Promise<boolean>;
}

/**
 * Установка, обновление и удаление расширений. Расширения ставятся по одному
 * в порядке списка; сбой одного не останавливает остальные. Сделанное
 * действует сразу: движок применяет его до ответа, окно перечитывает вклады
 * по `contributions-changed`.
 */
export const useInstall = (engine: LearningEngine): ExtensionInstall => {
  const phase = ref<InstallPhase>('idle');
  const items = shallowRef<InstallItem[]>([]);
  const removing = ref<string | null>(null);
  const removeError = ref<string | null>(null);

  const succeeded = computed(() =>
    items.value.some((item) => item.status === 'done'),
  );
  const failed = computed(() =>
    items.value.filter((item) => item.status === 'failed'),
  );
  const canRetry = computed(() =>
    failed.value.some((item) => item.failure?.retryable === true),
  );

  const patch = (index: number, changes: Partial<InstallItem>) => {
    items.value = items.value.map((item, at) =>
      at === index ? { ...item, ...changes } : item,
    );
  };

  const review = (targets: readonly InstallTarget[]) => {
    if (phase.value === 'running' || targets.length === 0) return;
    items.value = targets.map((target) => ({
      target,
      status: 'pending',
      failure: null,
    }));
    phase.value = 'confirm';
  };

  /** Закрывает диалог; пока идёт установка, закрыть нельзя. */
  const dismiss = () => {
    if (phase.value === 'running') return;
    phase.value = 'idle';
    items.value = [];
  };

  const installOne = async (index: number, target: InstallTarget) => {
    patch(index, { status: 'running', failure: null });
    try {
      await engine.extensions.install(target.id, target.version);
      patch(index, { status: 'done' });
    } catch (caught) {
      patch(index, {
        status: 'failed',
        failure: describeInstallFailure(toEngineError(caught)),
      });
    }
  };

  const run = async () => {
    const queue = items.value.flatMap((item, index) =>
      isRunnable(item) ? [{ index, target: item.target }] : [],
    );
    phase.value = 'running';
    for (const { index, target } of queue) await installOne(index, target);
    phase.value = 'finished';
  };

  const confirm = async () => {
    if (phase.value === 'confirm') await run();
  };

  /** Повторяет только не удавшиеся. */
  const retry = async () => {
    if (phase.value === 'finished' && failed.value.length > 0) await run();
  };

  /** `true` — расширение удалено; `removeData` — вместе с его данными (по умолчанию данные остаются). */
  const remove = async (id: string, removeData = false): Promise<boolean> => {
    if (removing.value !== null) return false;
    removing.value = id;
    removeError.value = null;
    try {
      await engine.extensions.uninstall(id, { removeData });
      return true;
    } catch (caught) {
      removeError.value = toEngineError(caught).message;
      return false;
    } finally {
      removing.value = null;
    }
  };

  return {
    phase,
    items,
    succeeded,
    failed,
    canRetry,
    removing,
    removeError,
    review,
    dismiss,
    confirm,
    retry,
    remove,
  };
};

export const INSTALL_KEY: InjectionKey<ExtensionInstall> =
  Symbol('extension-install');

export const useInstallContext = (): ExtensionInstall => {
  const install = inject(INSTALL_KEY);
  if (!install) throw new Error('extension install is not provided');
  return install;
};

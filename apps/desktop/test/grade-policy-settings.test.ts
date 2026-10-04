import { effectScope, shallowRef } from 'vue';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';
import type {
  GradePolicyInfoDto,
  LearningEngine,
  LearningSettingsDto,
} from '@dolphy-app/engine-contract';
import { messages } from '@/pages/settings/i18n/index.ts';
import {
  toGradePolicyOptions,
  useGradePolicySetting,
} from '@/pages/settings/model/grade-policy.ts';

vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue')>()),
  onMounted: (hook: () => void) => void hook(),
}));

const GENEROUS: GradePolicyInfoDto = {
  id: 'acme.policy.generous',
  extensionId: 'acme.policy',
  label: 'Generous',
};
const BUILTIN: GradePolicyInfoDto = {
  id: 'passAtN',
  extensionId: null,
  label: null,
};

const createFakeEngine = (initial: LearningSettingsDto) => {
  let current = initial;
  const patches: Partial<LearningSettingsDto>[] = [];
  let failWith: Error | null = null;
  const engine = {
    settings: {
      getLearning: async () => ({ ...current }),
      setLearning: async (patch: Partial<LearningSettingsDto>) => {
        patches.push(patch);
        if (failWith) throw failWith;
        current = { ...current, ...patch };
        return { ...current };
      },
    },
  } as unknown as LearningEngine;
  return {
    engine,
    patches,
    failNext: (error: Error) => {
      failWith = error;
    },
  };
};

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const mount = async (
  saved: string,
  policies: readonly GradePolicyInfoDto[] = [BUILTIN, GENEROUS],
) => {
  const fake = createFakeEngine({ gradePolicy: saved });
  const scope = effectScope();
  const setting = scope.run(() => useGradePolicySetting(fake.engine, policies));
  if (!setting) throw new Error('scope is inactive');
  await flush();
  return { ...fake, setting, scope };
};

describe('toGradePolicyOptions', () => {
  it('puts the built-in rule first, once', () => {
    expect(
      toGradePolicyOptions([GENEROUS, BUILTIN]).map(({ id }) => id),
    ).toEqual(['passAtN', 'acme.policy.generous']);
    expect(toGradePolicyOptions([])).toEqual([
      { id: 'passAtN', label: null, extensionId: null },
    ]);
  });
});

describe('useGradePolicySetting', () => {
  it('adopts the saved extension rule after loading', async () => {
    const { setting } = await mount('acme.policy.generous');
    expect(setting.effective.value).toBe('acme.policy.generous');
    expect(setting.missing.value).toBe(false);
  });

  it('saves a chosen rule through setLearning and adopts the returned value', async () => {
    const { setting, patches } = await mount('passAtN');
    await setting.select('acme.policy.generous');
    expect(patches).toEqual([{ gradePolicy: 'acme.policy.generous' }]);
    expect(setting.effective.value).toBe('acme.policy.generous');
    expect(setting.busy.value).toBe(false);
  });

  it('rolls back and reports the error when saving fails', async () => {
    const { setting, failNext } = await mount('passAtN');
    failNext(new Error('disk full'));
    await setting.select('acme.policy.generous');
    expect(setting.effective.value).toBe('passAtN');
    expect(setting.error.value).toBe('disk full');
    expect(setting.busy.value).toBe(false);
  });

  it('ignores a deselect and re-selecting the current rule', async () => {
    const { setting, patches } = await mount('passAtN');
    await setting.select(null);
    await setting.select('passAtN');
    expect(patches).toEqual([]);
  });

  it('a saved id that no extension provides is flagged; the effective rule is passAtN', async () => {
    const { setting, patches } = await mount('gone.policy', [BUILTIN]);
    expect(setting.saved.value).toBe('gone.policy');
    expect(setting.missing.value).toBe(true);
    expect(setting.effective.value).toBe('passAtN');
    // явный выбор passAtN заменяет недоступное сохранённое правило
    await setting.select('passAtN');
    expect(patches).toEqual([{ gradePolicy: 'passAtN' }]);
    expect(setting.missing.value).toBe(false);
  });
});

describe('useGradePolicySetting: вклады меняются без перезагрузки окна', () => {
  it('правило появляется и пропадает вместе с расширением; выбор в БД не трогается', async () => {
    const policies = shallowRef<readonly GradePolicyInfoDto[]>([BUILTIN]);
    const fake = createFakeEngine({ gradePolicy: 'acme.policy.generous' });
    const setting = effectScope().run(() =>
      useGradePolicySetting(fake.engine, policies),
    )!;
    await flush();
    expect(setting.options.value.map(({ id }) => id)).toEqual(['passAtN']);
    expect(setting.missing.value).toBe(true);
    expect(setting.effective.value).toBe('passAtN');

    policies.value = [BUILTIN, GENEROUS];
    expect(setting.options.value.map(({ id }) => id)).toEqual([
      'passAtN',
      'acme.policy.generous',
    ]);
    expect(setting.missing.value).toBe(false);
    expect(setting.effective.value).toBe('acme.policy.generous');

    policies.value = [BUILTIN];
    expect(setting.missing.value).toBe(true);
    expect(setting.saved.value).toBe('acme.policy.generous');
    expect(fake.patches).toEqual([]);
  });
});

describe('i18n правила оценки', () => {
  it.each(['ru', 'en'] as const)(
    'сообщения %s компилируются; «@» не принимается за ссылку',
    (locale) => {
      const i18n = createI18n({
        legacy: false,
        locale,
        messages,
        missingWarn: false,
        missing: (_locale, key) => {
          throw new Error(`missing ${key}`);
        },
      });
      const { t } = i18n.global;
      expect(t('settings.learning.gradePolicy.passAtN.title')).toBe('Pass@N');
      expect(
        t('settings.learning.gradePolicy.missing', { id: 'gone.policy' }),
      ).toContain('gone.policy');
      expect(t('settings.learning.gradePolicy.passAtN.description')).not.toBe(
        '',
      );
    },
  );
});

import { describe, expect, it } from 'vitest';
import * as vue from 'vue';
import { HOST_MODULES } from '../../../packages/extension-tools/src/host-modules.ts';
import {
  HOST_LOADERS,
  installHostModules,
} from '../src/shared/lib/host-modules.ts';

describe('host modules', () => {
  it('таблица загрузчиков совпадает с HOST_MODULES', () => {
    expect(Object.keys(HOST_LOADERS).sort()).toEqual([...HOST_MODULES].sort());
  });

  it('require("vue") отдаёт тот же модуль, что и import', async () => {
    installHostModules();
    expect(await globalThis.__dolphy?.require('vue')).toBe(vue);
  });

  it('неизвестное имя — понятная ошибка', async () => {
    installHostModules();
    await expect(globalThis.__dolphy?.require('lodash')).rejects.toThrow(
      'unknown host module: lodash',
    );
    await expect(globalThis.__dolphy?.require('toString')).rejects.toThrow(
      'unknown host module',
    );
  });
});

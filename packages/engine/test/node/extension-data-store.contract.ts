import type { JsonValue } from '@dolphy-app/engine-contract';
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_STORAGE_LIMITS,
  SECRET_STORE_LIMITS,
} from '../../src/domain/index.ts';
import type { StorageLimits } from '../../src/domain/index.ts';
import type {
  ExtensionDataSpace,
  ExtensionDataStore,
} from '../../src/ports/index.ts';

const A = 'acme.alpha';
const B = 'acme.beta';

/** Строка, чей JSON-текст занимает ровно `bytes` байт UTF-8 (`"` + буквы + `"`). */
const jsonOfSize = (bytes: number, letter = 'a'): string =>
  letter.repeat((bytes - 2) / Buffer.byteLength(letter));

const quota = (kind: string, limit: number) =>
  expect.objectContaining({
    code: 'EXTENSION_STORAGE_QUOTA',
    retryable: false,
    details: { extensionId: A, kind, limit },
  });

const spaces: readonly (readonly [
  string,
  (s: ExtensionDataStore) => ExtensionDataSpace,
  StorageLimits,
])[] = [
  ['storage', (store) => store.storage, EXTENSION_STORAGE_LIMITS],
  ['settings', (store) => store.settings, EXTENSION_STORAGE_LIMITS],
  // секреты: в хранилище лежит шифртекст, у него свои потолки
  ['secrets', (store) => store.secrets, SECRET_STORE_LIMITS],
];

/** Общий набор проверок адаптеров `ExtensionDataStore` (память, SQLite). */
export const describeExtensionDataStoreContract = (
  name: string,
  make: () => Promise<ExtensionDataStore>,
) =>
  describe(`ExtensionDataStore (${name})`, () => {
    describe.each(spaces)('%s', (_, pick, limits) => {
      const { valueBytes, keys: maxKeys, totalBytes } = limits;
      // у секретов ключей меньше, чем слотов под общий размер: потолок размера недостижим
      const totalReachable = totalBytes / valueBytes < maxKeys;
      const open = async () => pick(await make());

      it('отсутствующий ключ — undefined, пустые keys/all/usage', async () => {
        const space = await open();
        expect(await space.get(A, 'k')).toBeUndefined();
        expect(await space.keys(A)).toEqual([]);
        expect(await space.all(A)).toEqual({});
        expect(await space.usage(A)).toEqual({ keys: 0, bytes: 0 });
      });

      it('любой JSON переживает round-trip', async () => {
        const space = await open();
        const values: JsonValue[] = [
          null,
          false,
          0,
          -1.5,
          '',
          'текст 😀',
          [1, [2, { a: null }]],
          { nested: { list: [true, 'x'], empty: {} } },
        ];
        for (const [i, value] of values.entries()) {
          await space.set(A, `k${i}`, value);
        }
        for (const [i, value] of values.entries()) {
          expect(await space.get(A, `k${i}`)).toEqual(value);
        }
      });

      it('пространства расширений независимы', async () => {
        const space = await open();
        await space.set(A, 'k', 'a');
        await space.set(B, 'k', 'b');
        expect(await space.get(A, 'k')).toBe('a');
        expect(await space.get(B, 'k')).toBe('b');
        expect(await space.delete(A, 'k')).toBe(true);
        expect(await space.get(B, 'k')).toBe('b');
      });

      it('перезапись заменяет значение и не плодит ключи', async () => {
        const space = await open();
        await space.set(A, 'k', { v: 1 });
        await space.set(A, 'k', 'two');
        expect(await space.get(A, 'k')).toBe('two');
        expect(await space.keys(A)).toEqual(['k']);
      });

      it('delete: true один раз, затем false; соседние ключи целы', async () => {
        const space = await open();
        await space.set(A, 'a', 1);
        await space.set(A, 'b', 2);
        expect(await space.delete(A, 'a')).toBe(true);
        expect(await space.delete(A, 'a')).toBe(false);
        expect(await space.delete(A, 'nope')).toBe(false);
        expect(await space.keys(A)).toEqual(['b']);
      });

      it('keys и all отсортированы по кодовым точкам, а не по кодовым единицам', async () => {
        const space = await open();
        // U+FFEE (BMP) < U+1F600 (в UTF-16 суррогат D83D идёт раньше FFEE)
        const ordered = ['B', 'a', 'é', 'я', '\uffee', '😀'];
        for (const key of [...ordered].reverse()) await space.set(A, key, key);
        expect(await space.keys(A)).toEqual(ordered);
        expect(Object.keys(await space.all(A))).toEqual(ordered);
      });

      it('ключ __proto__ — обычный ключ', async () => {
        const space = await open();
        await space.set(A, '__proto__', { polluted: true });
        const all = await space.all(A);
        expect(Object.keys(all)).toEqual(['__proto__']);
        expect(Reflect.get({}, 'polluted')).toBeUndefined();
      });

      it('копии изолированы: вход и выход можно мутировать', async () => {
        const space = await open();
        const input = { list: [1] };
        await space.set(A, 'k', input);
        input.list.push(2);
        const out = await space.get(A, 'k');
        if (typeof out !== 'object' || out === null || !('list' in out)) {
          throw new Error('unexpected value shape');
        }
        (out.list as number[]).push(3);
        const all = await space.all(A);
        const viaAll = all['k'];
        if (
          typeof viaAll !== 'object' ||
          viaAll === null ||
          !('list' in viaAll)
        ) {
          throw new Error('unexpected value shape');
        }
        (viaAll.list as number[]).push(4);
        expect(await space.get(A, 'k')).toEqual({ list: [1] });
      });

      it('не JSON и пустой ключ — INVALID_ARGUMENT, данные целы', async () => {
        const space = await open();
        await space.set(A, 'k', 'keep');
        const cyclic: Record<string, unknown> = {};
        cyclic['self'] = cyclic;
        for (const [key, value] of [
          ['k', undefined],
          ['k', () => 1],
          ['k', cyclic],
          ['k', 10n],
          ['', 'x'],
        ] as const) {
          await expect(
            space.set(A, key, value as unknown as JsonValue),
          ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        }
        expect(await space.get(A, 'k')).toBe('keep');
        expect(await space.keys(A)).toEqual(['k']);
      });

      it('usage считает ключи и байты UTF-8 JSON-текста', async () => {
        const space = await open();
        await space.set(A, 'a', 'я'); // "я" = 4 байта
        await space.set(A, 'b', { x: 1 }); // {"x":1} = 7 байт
        await space.set(B, 'c', 1);
        expect(await space.usage(A)).toEqual({ keys: 2, bytes: 11 });
        expect(await space.usage(B)).toEqual({ keys: 1, bytes: 1 });
      });

      it('deleteAll стирает только своё расширение', async () => {
        const space = await open();
        await space.set(A, 'a', 1);
        await space.set(B, 'b', 2);
        await space.deleteAll(A);
        await space.deleteAll('acme.none');
        expect(await space.keys(A)).toEqual([]);
        expect(await space.get(B, 'b')).toBe(2);
      });

      describe('потолки', () => {
        it('ключ: 128 допустимо, 129 — key-length, запись не происходит', async () => {
          const space = await open();
          await space.set(A, 'k'.repeat(128), 1);
          await expect(space.set(A, 'k'.repeat(129), 1)).rejects.toMatchObject(
            quota('key-length', 128),
          );
          expect(await space.keys(A)).toEqual(['k'.repeat(128)]);
        });

        it('значение: ровно потолок допустимо, на байт больше — value-size', async () => {
          const space = await open();
          const exact = jsonOfSize(valueBytes);
          await space.set(A, 'k', exact);
          await expect(space.set(A, 'k', `${exact}a`)).rejects.toMatchObject(
            quota('value-size', valueBytes),
          );
          expect(await space.get(A, 'k')).toBe(exact);
          expect(await space.usage(A)).toEqual({ keys: 1, bytes: valueBytes });
        });

        it('значение считается в байтах, а не в символах', async () => {
          const space = await open();
          const wide = jsonOfSize(valueBytes, 'я'); // вдвое меньше символов, чем байт
          expect(wide.length).toBeLessThan(valueBytes / 2);
          await space.set(A, 'k', wide);
          await expect(space.set(A, 'k2', `${wide}я`)).rejects.toMatchObject(
            quota('value-size', valueBytes),
          );
        });

        it('ключей: ровно потолок допустимо, следующий — key-count; перезапись существующего допустима', async () => {
          const space = await open();
          for (let i = 0; i < maxKeys; i++) await space.set(A, `k${i}`, i);
          await expect(space.set(A, 'extra', 1)).rejects.toMatchObject(
            quota('key-count', maxKeys),
          );
          await space.set(A, 'k0', 'overwritten');
          expect(await space.get(A, 'k0')).toBe('overwritten');
          expect((await space.keys(A)).length).toBe(maxKeys);
          // чужое расширение потолок не делит
          await space.set(B, 'k', 1);
        });

        it.skipIf(!totalReachable)(
          'всего: ровно потолок допустимо, на байт больше — total-size, остальное не меняется',
          async () => {
            const space = await open();
            const full = jsonOfSize(valueBytes);
            const slots = totalBytes / valueBytes;
            for (let i = 0; i < slots; i++) await space.set(A, `k${i}`, full);
            expect((await space.usage(A)).bytes).toBe(totalBytes);
            await expect(space.set(A, 'more', 1)).rejects.toMatchObject(
              quota('total-size', totalBytes),
            );
            // перезапись равным по размеру допустима, большим — нет
            await space.set(A, 'k0', jsonOfSize(valueBytes, 'b'));
            await expect(
              space.set(A, 'k0', `${jsonOfSize(valueBytes, 'c')}c`),
            ).rejects.toMatchObject(quota('value-size', valueBytes));
            // уменьшение освобождает место
            await space.set(A, 'k0', 1);
            await space.set(A, 'more', jsonOfSize(valueBytes - 1));
            expect((await space.usage(A)).bytes).toBeLessThanOrEqual(
              totalBytes,
            );
            expect(await space.get(A, 'k1')).toBe(full);
          },
        );

        it.skipIf(!totalReachable)(
          'отказ при переполнении итога не меняет старое значение',
          async () => {
            const space = await open();
            const big = jsonOfSize(valueBytes);
            const slots = totalBytes / valueBytes;
            for (let i = 0; i < slots - 1; i++)
              await space.set(A, `k${i}`, big);
            await space.set(A, 'pad', jsonOfSize(valueBytes - 10)); // остаток — 10 байт
            await space.set(A, 'small', 'x'); // 3 байта: остаток 7
            await expect(
              space.set(A, 'small', jsonOfSize(30)),
            ).rejects.toMatchObject(quota('total-size', totalBytes));
            expect(await space.get(A, 'small')).toBe('x');
            await space.set(A, 'small', jsonOfSize(10)); // ровно в остаток
          },
        );
      });
    });

    it('хранилище кода, значения настроек и секреты не пересекаются и не делят потолки', async () => {
      const { valueBytes, totalBytes } = EXTENSION_STORAGE_LIMITS;
      const store = await make();
      await store.secrets.set(A, 'k', 'cipher');
      await store.storage.set(A, 'k', 'code');
      await store.settings.set(A, 'k', 'setting');
      expect(await store.storage.get(A, 'k')).toBe('code');
      expect(await store.settings.get(A, 'k')).toBe('setting');
      const big = jsonOfSize(valueBytes);
      for (let i = 0; i < totalBytes / valueBytes - 1; i++) {
        await store.storage.set(A, `big${i}`, big);
      }
      await store.storage.set(A, 'pad', jsonOfSize(valueBytes - 6)); // `"code"` = 6 байт
      await expect(store.storage.set(A, 'z', 1)).rejects.toMatchObject(
        quota('total-size', totalBytes),
      );
      await store.settings.set(A, 'fresh', 1);
      expect(await store.settings.usage(A)).toEqual({ keys: 2, bytes: 9 + 1 });
      expect(await store.secrets.get(A, 'k')).toBe('cipher');
      expect(await store.secrets.keys(A)).toEqual(['k']);
    });

    it('deleteAllData стирает все три пространства только своего расширения', async () => {
      const store = await make();
      await store.storage.set(A, 'k', 1);
      await store.settings.set(A, 'k', 2);
      await store.secrets.set(A, 'k', 'a');
      await store.storage.set(B, 'k', 3);
      await store.settings.set(B, 'k', 4);
      await store.secrets.set(B, 'k', 'b');
      await store.deleteAllData(A);
      expect(await store.storage.keys(A)).toEqual([]);
      expect(await store.settings.keys(A)).toEqual([]);
      expect(await store.secrets.keys(A)).toEqual([]);
      expect(await store.secrets.get(B, 'k')).toBe('b');
      expect(await store.storage.get(B, 'k')).toBe(3);
      expect(await store.settings.get(B, 'k')).toBe(4);
    });
  });

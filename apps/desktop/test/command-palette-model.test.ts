import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';
import type { CommandDescriptor } from '@/shared/lib/command-registry.ts';
import { createCommandPalette } from '@/widgets/command-palette/model/palette.ts';

const run = vi.fn<() => Promise<void>>(async () => undefined);

const command = (
  id: string,
  override: Partial<CommandDescriptor> = {},
): CommandDescriptor => ({
  key: `acme.cmd:${id}`,
  source: 'extension',
  title: id,
  caption: 'acme.cmd',
  run: () => run(),
  ...override,
});

const setup = (initial: CommandDescriptor[]) => {
  run.mockReset();
  run.mockResolvedValue(undefined);
  const registry = createCommandRegistry();
  const disposers = new Map<string, () => void>();
  const add = (descriptor: CommandDescriptor) => {
    disposers.set(descriptor.key, registry.register(descriptor));
  };
  const remove = (id: string) => disposers.get(`acme.cmd:${id}`)?.();
  initial.forEach(add);
  const palette = createCommandPalette({ registry });
  const titles = () => palette.entries.value.map(({ title }) => title);
  return { add, remove, palette, titles };
};

describe('палитра команд: список и выбор', () => {
  it('открытие сбрасывает запрос и выбирает первую строку; повторное открытие ничего не сбрасывает', () => {
    const { palette, titles } = setup([command('b'), command('a')]);
    palette.query.value = 'a';
    palette.open();
    expect(palette.isOpen.value).toBe(true);
    expect(palette.query.value).toBe('');
    expect(titles()).toEqual(['a', 'b']);
    expect(palette.activeKey.value).toBe('acme.cmd:a');
    palette.move(1);
    palette.open();
    expect(palette.activeKey.value).toBe('acme.cmd:b');
  });

  it('стрелки двигают выбор по кругу, пустой список — выбора нет', () => {
    const { palette } = setup([command('a'), command('b'), command('c')]);
    palette.open();
    palette.move(-1);
    expect(palette.activeKey.value).toBe('acme.cmd:c');
    palette.move(1);
    expect(palette.activeKey.value).toBe('acme.cmd:a');
    palette.query.value = 'нет такой';
    expect(palette.entries.value).toEqual([]);
    expect(palette.activeKey.value).toBeNull();
    palette.move(1);
    expect(palette.activeKey.value).toBeNull();
  });

  it('новый запрос возвращает выбор на первую строку', () => {
    const { palette } = setup([
      command('alpha'),
      command('beta'),
      command('bravo'),
    ]);
    palette.open();
    palette.move(2);
    expect(palette.activeKey.value).toBe('acme.cmd:bravo');
    palette.query.value = 'b';
    expect(palette.activeKey.value).toBe('acme.cmd:beta');
  });

  it('выбор держится за командой: новые строки выше не сдвигают его', () => {
    const { palette, add } = setup([command('b'), command('c')]);
    palette.open();
    palette.move(1);
    expect(palette.activeKey.value).toBe('acme.cmd:c');
    add(command('a'));
    expect(palette.activeKey.value).toBe('acme.cmd:c');
  });

  it('выбранная команда пропала: выбор остаётся на том же месте, у края — на последней строке', () => {
    const { palette, add, remove } = setup([
      command('a'),
      command('b'),
      command('c'),
    ]);
    palette.open();
    palette.move(1);
    remove('b');
    expect(palette.activeKey.value).toBe('acme.cmd:c');
    remove('c');
    expect(palette.activeKey.value).toBe('acme.cmd:a');
    remove('a');
    expect(palette.activeKey.value).toBeNull();
    add(command('z'));
    expect(palette.activeKey.value).toBe('acme.cmd:z');
  });

  it('снятая команда исчезает из списка при живом обновлении реестра', () => {
    const { palette, remove, titles } = setup([command('a'), command('b')]);
    palette.open();
    expect(titles()).toEqual(['a', 'b']);
    remove('b');
    expect(titles()).toEqual(['a']);
  });

  it('недоступная команда не показывается и появляется, когда становится доступной', () => {
    const enabled = ref(false);
    const { palette, titles } = setup([
      command('shown'),
      command('hidden', { enabled }),
    ]);
    palette.open();
    expect(titles()).toEqual(['shown']);
    enabled.value = true;
    expect(titles()).toEqual(['hidden', 'shown']);
  });

  it('названия следуют за языком: порядок и поиск пересчитываются', () => {
    const language = ref<'ru' | 'en'>('ru');
    const { palette, titles } = setup([
      command('go', {
        title: () => (language.value === 'ru' ? 'Курсы' : 'Courses'),
      }),
      command('theme', {
        title: () => (language.value === 'ru' ? 'Тема' : 'Appearance'),
      }),
    ]);
    palette.open();
    expect(titles()).toEqual(['Курсы', 'Тема']);
    palette.query.value = 'курс';
    expect(titles()).toEqual(['Курсы']);
    language.value = 'en';
    expect(titles()).toEqual([]);
    palette.query.value = 'cour';
    expect(titles()).toEqual(['Courses']);
    palette.query.value = '';
    expect(titles()).toEqual(['Appearance', 'Courses']);
  });

  it('activate по ключу ставит выбор, неизвестный ключ игнорируется', () => {
    const { palette } = setup([command('a'), command('b')]);
    palette.open();
    palette.activate('acme.cmd:b');
    expect(palette.activeKey.value).toBe('acme.cmd:b');
    palette.activate('acme.cmd:nope');
    expect(palette.activeKey.value).toBe('acme.cmd:b');
  });
});

describe('палитра команд: выполнение', () => {
  it('Enter: закрывает палитру и выполняет выбранную команду', async () => {
    const b = vi.fn();
    const { palette } = setup([command('a'), command('b', { run: b })]);
    palette.open();
    palette.move(1);
    await palette.choose();
    expect(palette.isOpen.value).toBe(false);
    expect(b).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it('выбор строки по ключу (щелчок) выполняет именно её', async () => {
    const b = vi.fn();
    const { palette } = setup([command('a'), command('b', { run: b })]);
    palette.open();
    await palette.choose('acme.cmd:b');
    expect(b).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it('команда приложения и команда расширения выполняются одинаково', async () => {
    const appRun = vi.fn();
    const { palette } = setup([
      command('ext'),
      command('x', { key: 'app:go:x', source: 'app', run: appRun }),
    ]);
    palette.open();
    await palette.choose('app:go:x');
    await palette.choose('acme.cmd:ext');
    expect(appRun).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it('пока команда выполняется, повторный запуск отключён; после — снова доступен', async () => {
    let finish: () => void = () => undefined;
    const { palette } = setup([command('slow')]);
    run.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    palette.open();
    const first = palette.choose();
    expect(palette.isBusy('acme.cmd:slow')).toBe(true);
    palette.open();
    await palette.choose();
    expect(run).toHaveBeenCalledOnce();
    expect(palette.isOpen.value).toBe(true);
    finish();
    await first;
    expect(palette.isBusy('acme.cmd:slow')).toBe(false);
    await palette.choose();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('состояние «выполняется» держится за ключом при живом изменении списка', async () => {
    let finish: () => void = () => undefined;
    const { palette, add } = setup([command('slow')]);
    run.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    palette.open();
    const first = palette.choose();
    add(command('new'));
    expect(palette.isBusy('acme.cmd:slow')).toBe(true);
    expect(palette.isBusy('acme.cmd:new')).toBe(false);
    finish();
    await first;
  });

  it('сбой выполнения освобождает команду', async () => {
    const { palette } = setup([command('a')]);
    run.mockRejectedValueOnce(new Error('boom'));
    palette.open();
    await expect(palette.choose()).rejects.toThrow('boom');
    expect(palette.isBusy('acme.cmd:a')).toBe(false);
  });

  it('команда, пропавшая до выбора, не выполняется; пустой список — ничего', async () => {
    const { palette, remove } = setup([command('a')]);
    palette.open();
    remove('a');
    await palette.choose();
    await palette.choose('acme.cmd:a');
    expect(run).not.toHaveBeenCalled();
  });
});

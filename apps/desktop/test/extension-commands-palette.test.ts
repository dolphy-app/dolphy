import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContributionDto } from '@dolphy-app/engine-contract';
import { createCommandPalette } from '@/features/extension-commands/model/palette.ts';

const command = (
  id: string,
  override: Partial<CommandContributionDto> = {},
): CommandContributionDto => ({
  id,
  extensionId: 'acme.cmd',
  title: id,
  description: null,
  category: null,
  keybinding: null,
  palette: true,
  ...override,
});

const setup = (initial: CommandContributionDto[]) => {
  const commands = ref(initial);
  const run = vi.fn<(item: CommandContributionDto) => Promise<void>>(
    async () => undefined,
  );
  const palette = createCommandPalette({ commands: () => commands.value, run });
  const titles = () => palette.entries.value.map(({ command: c }) => c.id);
  return { commands, run, palette, titles };
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
    const { palette, commands } = setup([command('b'), command('c')]);
    palette.open();
    palette.move(1);
    expect(palette.activeKey.value).toBe('acme.cmd:c');
    commands.value = [command('a'), ...commands.value];
    expect(palette.activeKey.value).toBe('acme.cmd:c');
  });

  it('выбранная команда пропала: выбор остаётся на том же месте, у края — на последней строке', () => {
    const { palette, commands } = setup([
      command('a'),
      command('b'),
      command('c'),
    ]);
    palette.open();
    palette.move(1);
    commands.value = commands.value.filter(({ id }) => id !== 'b');
    expect(palette.activeKey.value).toBe('acme.cmd:c');
    commands.value = commands.value.filter(({ id }) => id !== 'c');
    expect(palette.activeKey.value).toBe('acme.cmd:a');
    commands.value = [];
    expect(palette.activeKey.value).toBeNull();
    commands.value = [command('z')];
    expect(palette.activeKey.value).toBe('acme.cmd:z');
  });

  it('команды отключённого расширения исчезают из списка при обновлении вкладов', () => {
    const { palette, commands, titles } = setup([
      command('a'),
      command('b', { extensionId: 'acme.other' }),
    ]);
    palette.open();
    expect(titles()).toEqual(['a', 'b']);
    commands.value = commands.value.filter(
      ({ extensionId }) => extensionId !== 'acme.other',
    );
    expect(titles()).toEqual(['a']);
  });

  it('palette:false не попадает в список', () => {
    const { palette, titles } = setup([
      command('shown'),
      command('hidden', { palette: false }),
    ]);
    palette.open();
    expect(titles()).toEqual(['shown']);
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
    const { palette, run } = setup([command('a'), command('b')]);
    palette.open();
    palette.move(1);
    await palette.choose();
    expect(palette.isOpen.value).toBe(false);
    expect(run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'b' }),
    );
  });

  it('выбор строки по ключу (щелчок) выполняет именно её', async () => {
    const { palette, run } = setup([command('a'), command('b')]);
    palette.open();
    await palette.choose('acme.cmd:b');
    expect(run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'b' }),
    );
  });

  it('пока команда выполняется, повторный запуск отключён; после — снова доступен', async () => {
    let finish: () => void = () => undefined;
    const { palette, run } = setup([command('slow')]);
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

  it('сбой выполнения освобождает команду', async () => {
    const { palette, run } = setup([command('a')]);
    run.mockRejectedValueOnce(new Error('boom'));
    palette.open();
    await expect(palette.choose()).rejects.toThrow('boom');
    expect(palette.isBusy('acme.cmd:a')).toBe(false);
  });

  it('команда, пропавшая до выбора, не выполняется; пустой список — ничего', async () => {
    const { palette, run, commands } = setup([command('a')]);
    palette.open();
    commands.value = [];
    await palette.choose();
    await palette.choose('acme.cmd:a');
    expect(run).not.toHaveBeenCalled();
  });
});

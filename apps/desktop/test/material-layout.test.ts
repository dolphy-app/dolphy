import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  LearningEngine,
  UiSettingsDto,
  UiSettingsPatch,
} from '@dolphy-app/engine-contract';
import {
  clampWidth,
  maxWidth,
  widthFromKey,
} from '@/widgets/exercise-panel/lib/material-layout.ts';
import { createMaterialLayout } from '@/widgets/exercise-panel/model/material-layout.ts';

describe('material panel width limits', () => {
  it('is never narrower than 280 px or wider than 800 px', () => {
    expect(clampWidth(10, 2000)).toBe(280);
    expect(clampWidth(5000, 4000)).toBe(800);
  });

  it('leaves at most 60% of a narrow workspace to the panel, but not below the minimum', () => {
    expect(maxWidth(1000)).toBe(600);
    expect(clampWidth(700, 1000)).toBe(600);
    expect(maxWidth(300)).toBe(280);
  });

  it('rounds to whole pixels because the engine stores integers', () => {
    expect(clampWidth(400.6, 2000)).toBe(401);
  });
});

describe('widthFromKey', () => {
  it('moves the border by 16 px, or 64 px with Shift', () => {
    expect(widthFromKey('ArrowRight', false, 400, 2000)).toBe(416);
    expect(widthFromKey('ArrowLeft', false, 400, 2000)).toBe(384);
    expect(widthFromKey('ArrowRight', true, 400, 2000)).toBe(464);
  });

  it('stops at the limits', () => {
    expect(widthFromKey('ArrowLeft', false, 285, 2000)).toBe(280);
    expect(widthFromKey('ArrowRight', true, 790, 2000)).toBe(800);
  });

  it('jumps to the edges with Home and End', () => {
    expect(widthFromKey('Home', false, 500, 2000)).toBe(280);
    expect(widthFromKey('End', false, 500, 1000)).toBe(600);
  });

  it('ignores other keys', () => {
    expect(widthFromKey('Enter', false, 400, 2000)).toBeNull();
  });
});

const fakeEngine = (ui: UiSettingsDto, options: { failSet?: boolean } = {}) => {
  const setUi = vi.fn(async (_patch: UiSettingsPatch) => {
    if (options.failSet) throw new Error('disk is full');
    return ui;
  });
  const getUi = vi.fn(async () => ui);
  const engine = { settings: { getUi, setUi } } as unknown as LearningEngine;
  return { engine, setUi, getUi };
};

describe('material panel layout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads the saved width and collapse once', async () => {
    const { engine, getUi } = fakeEngine({
      theme: 'system',
      locale: 'system',
      materialWidth: 420,
      materialCollapsed: true,
    });
    const layout = createMaterialLayout(engine);
    await layout.hydrate();
    await layout.hydrate();
    expect(layout.state).toEqual({ width: 420, collapsed: true });
    expect(getUi).toHaveBeenCalledTimes(1);
  });

  it('writes nothing while the border is dragged, then once on release', async () => {
    const { engine, setUi } = fakeEngine({ theme: 'system', locale: 'system' });
    const layout = createMaterialLayout(engine);
    await layout.hydrate();
    for (const width of [300, 340, 380]) layout.preview(width);
    expect(layout.state.width).toBe(380);
    expect(setUi).not.toHaveBeenCalled();
    await layout.commit();
    expect(setUi).toHaveBeenCalledOnce();
    expect(setUi).toHaveBeenCalledWith({ materialWidth: 380 });
  });

  it('merges a burst of key presses into one write', async () => {
    vi.useFakeTimers();
    const { engine, setUi } = fakeEngine({ theme: 'system', locale: 'system' });
    const layout = createMaterialLayout(engine);
    for (const width of [416, 432, 448]) {
      layout.preview(width);
      layout.commitSoon();
    }
    await vi.advanceTimersByTimeAsync(400);
    expect(setUi).toHaveBeenCalledOnce();
    expect(setUi).toHaveBeenCalledWith({ materialWidth: 448 });
  });

  it('resets to the default width with null', async () => {
    const { engine, setUi } = fakeEngine({
      theme: 'system',
      locale: 'system',
      materialWidth: 500,
    });
    const layout = createMaterialLayout(engine);
    await layout.hydrate();
    await layout.reset();
    expect(layout.state.width).toBeNull();
    expect(setUi).toHaveBeenCalledWith({ materialWidth: null });
  });

  it('a choice made before the engine answered is not overwritten by the saved one', async () => {
    const { engine } = fakeEngine({
      theme: 'system',
      locale: 'system',
      materialWidth: 500,
    });
    const layout = createMaterialLayout(engine);
    const pending = layout.hydrate();
    layout.preview(350);
    await pending;
    expect(layout.state.width).toBe(350);
  });

  it('keeps the local choice when the engine refuses to save', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine } = fakeEngine(
      { theme: 'system', locale: 'system' },
      { failSet: true },
    );
    const layout = createMaterialLayout(engine);
    await layout.setCollapsed(true);
    expect(layout.state.collapsed).toBe(true);
    expect(error).toHaveBeenCalled();
  });
});

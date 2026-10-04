import { describe, expect, it } from 'vitest';
import { safeModeSource } from '../electron/main/safe-mode.ts';

describe('safeModeSource', () => {
  it('без флага и переменной режим зависит только от настройки', () => {
    expect(safeModeSource(['app', '--lang=ru'], {})).toBeUndefined();
  });

  it('флаг --safe-mode среди прочих аргументов', () => {
    expect(safeModeSource(['app', '--lang=ru', '--safe-mode'], {})).toBe(
      'flag',
    );
  });

  it('переменная включает только значением 1', () => {
    expect(safeModeSource(['app'], { DOLPHY_SAFE_MODE: '1' })).toBe('env');
    for (const value of ['0', '', 'true', undefined]) {
      expect(
        safeModeSource(['app'], { DOLPHY_SAFE_MODE: value }),
      ).toBeUndefined();
    }
  });

  it('флаг сильнее переменной', () => {
    expect(safeModeSource(['--safe-mode'], { DOLPHY_SAFE_MODE: '1' })).toBe(
      'flag',
    );
  });

  it('похожий аргумент флагом не считается', () => {
    expect(safeModeSource(['--safe-mode=1', '--safe'], {})).toBeUndefined();
  });
});

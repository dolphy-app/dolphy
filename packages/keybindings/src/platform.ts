export type Platform = 'mac' | 'windows' | 'linux';

export const PLATFORMS: readonly Platform[] = ['mac', 'windows', 'linux'];

interface NavigatorLike {
  readonly platform?: string;
  readonly userAgent?: string;
}

/** Платформа окна по `navigator`: Mac, Windows, всё остальное — Linux. */
export const detectPlatform = (nav: NavigatorLike): Platform => {
  const platform = nav.platform ?? '';
  const agent = nav.userAgent ?? '';
  if (/^(Mac|iPhone|iPad|iPod)/i.test(platform)) return 'mac';
  if (/^Win/i.test(platform)) return 'windows';
  if (platform === '' && /Macintosh/i.test(agent)) return 'mac';
  if (platform === '' && /Windows/i.test(agent)) return 'windows';
  return 'linux';
};

/** Платформа процесса Node по `process.platform`. */
export const platformFromNode = (name: string): Platform => {
  if (name === 'darwin') return 'mac';
  if (name === 'win32') return 'windows';
  return 'linux';
};

import { describe, expect, it } from 'vitest';
import { changelogBetween } from '@/pages/settings/lib/changelog.ts';

const versions = (markdown: string, from: string, to: string) =>
  changelogBetween(markdown, from, to).map(({ version }) => version);

describe('changelogBetween', () => {
  const log = [
    '# Changelog',
    '',
    'Все изменения.',
    '',
    '## [1.3.0] - 2026-10-03',
    '',
    '- три',
    '',
    '## [1.2.0] - 2026-10-01',
    '',
    '### Added',
    '',
    '- два',
    '',
    '## v1.1.0',
    '',
    '- один',
    '',
    '## 1.0.0',
    '',
    '- ноль',
  ].join('\n');

  it('берёт версии новее установленной и не новее целевой, новые сверху', () => {
    expect(versions(log, '1.0.0', '1.3.0')).toEqual(['1.3.0', '1.2.0', '1.1.0']);
    expect(versions(log, '1.1.0', '1.2.0')).toEqual(['1.2.0']);
  });

  it('понимает заголовки `1.2.0`, `[1.2.0] - дата`, `v1.2.0`, `[1.2.0](url)`', () => {
    const forms = [
      '## 1.2.0',
      '## [1.2.0] - 2026-10-01',
      '## v1.2.0',
      '## [v1.2.0]',
      '## [1.2.0](https://example.com/compare) (2026-10-01)',
      '##  1.2.0 ',
    ];
    for (const heading of forms) {
      expect(versions(`${heading}\n\n- x`, '1.1.0', '1.2.0'), heading).toEqual([
        '1.2.0',
      ]);
    }
  });

  it('текст раздела — до следующего заголовка, заголовок хранится как написан', () => {
    const [first, second] = changelogBetween(log, '1.1.0', '1.3.0');
    expect(first).toEqual({
      version: '1.3.0',
      title: '[1.3.0] - 2026-10-03',
      body: '- три',
    });
    expect(second?.body).toBe('### Added\n\n- два');
  });

  it('нет подходящих разделов или нет разделов вовсе — пусто', () => {
    expect(versions(log, '1.3.0', '1.3.0')).toEqual([]);
    expect(versions('# Changelog\n\nпросто текст', '1.0.0', '2.0.0')).toEqual(
      [],
    );
    expect(versions('', '1.0.0', '2.0.0')).toEqual([]);
  });

  it('версия не semver — пусто', () => {
    expect(versions(log, 'latest', '1.3.0')).toEqual([]);
    expect(versions(log, '1.0.0', '1.x')).toEqual([]);
    expect(versions(log, '', '')).toEqual([]);
  });

  it('заголовки, не похожие на версию, и заголовки в блоках кода не начинают раздел', () => {
    const markdown = [
      '## Unreleased',
      '',
      '- черновик',
      '',
      '## 1.2.0',
      '',
      '```md',
      '## 9.9.9',
      '```',
      '',
      '### Notes',
      '',
      '## 1.2.0.1',
      '',
      '- не версия',
    ].join('\n');
    const sections = changelogBetween(markdown, '1.0.0', '9.9.9');
    expect(sections.map(({ version }) => version)).toEqual(['1.2.0']);
    expect(sections[0]?.body).toContain('## 9.9.9');
    expect(sections[0]?.body).toContain('### Notes');
    expect(sections[0]?.body).not.toContain('не версия');
  });

  it('предрелиз старше релиза; повтор версии берётся первый', () => {
    const markdown = '## 1.2.0\n\nрелиз\n\n## 1.2.0-rc.1\n\nrc\n\n## 1.2.0\n\nповтор';
    const sections = changelogBetween(markdown, '1.1.0', '1.2.0');
    expect(sections.map(({ version }) => version)).toEqual(['1.2.0', '1.2.0-rc.1']);
    expect(sections[0]?.body).toBe('релиз');
    expect(versions(markdown, '1.2.0-rc.1', '1.2.0')).toEqual(['1.2.0']);
  });

  it('переводы строк CRLF', () => {
    expect(versions('## 1.1.0\r\n\r\n- x\r\n', '1.0.0', '1.1.0')).toEqual(['1.1.0']);
  });
});

import { describe, expect, it } from 'vitest';
import type {
  ExtensionHealthDto,
  ExtensionInfoDto,
  ExtensionsDiagnosticsDto,
} from '@dolphy-app/engine-contract';
import {
  diagnosticsReport,
  redactHomePaths,
} from '@/pages/settings/lib/diagnostics-report.ts';
import type { DiagnosticsReportInput } from '@/pages/settings/lib/diagnostics-report.ts';
import { diagnosticsDto, extensionInfo } from './support/extensions-fakes.ts';

const health = (
  id: string,
  override: Partial<ExtensionHealthDto> = {},
): ExtensionHealthDto => ({
  id,
  failures: 0,
  lastFailure: null,
  lastActivationMs: null,
  suppressedUntil: null,
  ...override,
});

const input = (
  override: Partial<DiagnosticsReportInput> = {},
): DiagnosticsReportInput => ({
  app: {
    appVersion: '0.9.1',
    electron: '44.0.1',
    chrome: '140.0.1',
    node: '24.1.0',
    platform: 'darwin',
    arch: 'arm64',
  },
  engine: { contractVersion: 16, engineVersion: '0.4.2' },
  diagnostics: diagnosticsDto(),
  extensions: [],
  ...override,
});

describe('redactHomePaths', () => {
  it.each([
    ['/Users/alice/Library/x.log', '~/Library/x.log'],
    ['/home/alice/.config/dolphy', '~/.config/dolphy'],
    ['C:\\Users\\Bob\\AppData\\Roaming', '~\\AppData\\Roaming'],
    ['c:\\users\\bob\\x', '~\\x'],
    ['C:/Users/Bob/x', '~/x'],
    ['C:\\\\Users\\\\Bob\\\\x', '~\\\\x'],
    ['"/Users/alice/x"', '"~/x"'],
    ['file:///Users/alice/x.js', 'file:~/x.js'],
    ['/Users/John Smith/Documents', '~/Documents'],
  ])('%s → %s', (raw, expected) => {
    expect(redactHomePaths(raw)).toBe(expected);
  });

  it('несколько путей в одной строке и чужие пути не тронуты', () => {
    expect(
      redactHomePaths('open /Users/a/x and /home/b/y, see /opt/app/z'),
    ).toBe('open ~/x and ~/y, see /opt/app/z');
    expect(redactHomePaths('https://example.com/home/page')).toBe(
      'https://example.com/home/page',
    );
  });
});

describe('diagnosticsReport', () => {
  it('содержит версии, окружение, безопасный режим и состояние хоста', () => {
    const text = diagnosticsReport(
      input({
        diagnostics: diagnosticsDto({
          host: 'restarting',
          safeMode: { active: true, persisted: false, forcedBy: 'flag' },
        }),
      }),
    );
    expect(text).toContain('App version: 0.9.1');
    expect(text).toContain('Contract version: 16');
    expect(text).toContain('Engine version: 0.4.2');
    expect(text).toContain('Electron: 44.0.1');
    expect(text).toContain('Chrome: 140.0.1');
    expect(text).toContain('Node: 24.1.0');
    expect(text).toContain('Platform: darwin arm64');
    expect(text).toContain(
      'Safe mode: active=yes; persisted=no; forced by: flag',
    );
    expect(text).toContain('Extension host: restarting');
    expect(text).toContain('Extensions (0):');
  });

  it('список расширений: id, версия, происхождение, состояние, коды, изоляция, здоровье', () => {
    const list: ExtensionInfoDto[] = [
      extensionInfo('acme.sql', {
        version: '1.2.0',
        origin: 'user',
        state: 'invalid',
        isolation: 'isolated',
        diagnostics: [
          { code: 'manifest-invalid', data: { issues: ['secret issue'] } },
          { code: 'safe-mode', data: {} },
        ],
      }),
      extensionInfo('dolphy.choice', { version: null }),
    ];
    const diagnostics = diagnosticsDto({
      extensions: [
        health('acme.sql', {
          failures: 3,
          lastFailure: {
            at: Date.UTC(2026, 9, 4, 12, 30, 0),
            reason: 'handler-failed',
            message: 'boom',
          },
          lastActivationMs: 42,
          suppressedUntil: Date.UTC(2026, 9, 4, 12, 35, 0),
        }),
        health('dolphy.choice'),
      ],
    });
    const text = diagnosticsReport(input({ extensions: list, diagnostics }));

    expect(text).toContain('Extensions (2):');
    expect(text).toContain('- acme.sql 1.2.0');
    expect(text).toContain('origin: user; state: invalid; isolation: isolated');
    expect(text).toContain('diagnostics: manifest-invalid, safe-mode');
    expect(text).toContain('failures=3');
    expect(text).toContain(
      'last failure: handler-failed at 2026-10-04T12:30:00.000Z: boom',
    );
    expect(text).toContain('last activation: 42 ms');
    expect(text).toContain('suppressed until: 2026-10-04T12:35:00.000Z');
    expect(text).toContain('- dolphy.choice unknown');
    expect(text).toContain(
      'health: failures=0; last failure: none; last activation: none; suppressed until: none',
    );
  });

  it('расширение без записи здоровья помечено, а не пропущено', () => {
    const text = diagnosticsReport(
      input({ extensions: [extensionInfo('acme.x')] }),
    );
    expect(text).toContain('- acme.x 1.0.0');
    expect(text).toContain('health: unavailable');
  });

  it('домашние пути в тексте сбоя и в любых строках заменены на ~', () => {
    const message =
      'ENOENT /Users/alice/project/ext.js; also C:\\Users\\Bob\\ext\\main.js and /home/carol/x';
    const text = diagnosticsReport(
      input({
        extensions: [extensionInfo('acme.sql')],
        diagnostics: diagnosticsDto({
          extensions: [
            health('acme.sql', {
              failures: 1,
              lastFailure: { at: 0, reason: 'timeout', message },
            }),
          ],
        }),
        engine: {
          contractVersion: 16,
          engineVersion: '/Users/alice/engine',
        },
      }),
    );
    expect(text).toContain('~/project/ext.js');
    expect(text).toContain('~\\ext\\main.js');
    expect(text).toContain('~/x');
    expect(text).toContain('Engine version: ~/engine');
    expect(text).not.toMatch(/alice|Bob|carol/);
    expect(text).not.toContain('/Users/');
    expect(text).not.toContain('C:\\Users');
  });

  it('текст сбоя не подделывает строки отчёта и не бесконечен', () => {
    const text = diagnosticsReport(
      input({
        extensions: [extensionInfo('acme.sql')],
        diagnostics: diagnosticsDto({
          extensions: [
            health('acme.sql', {
              lastFailure: {
                at: 0,
                reason: 'handler-failed',
                message: `line1\nSafe mode: forged\n${'x'.repeat(5000)}`,
              },
            }),
          ],
        }),
      }),
    );
    expect(text.match(/^Safe mode:/gm)).toHaveLength(1);
    expect(text.length).toBeLessThan(2000);
  });

  it('лишние поля DTO (путь библиотеки, значения настроек, хранилище) в отчёт не попадают', () => {
    const smuggled = {
      libraryRoot: '/Volumes/secret-library-root',
      settingValues: { apiKey: 'SETTING-VALUE-123' },
      storage: { token: 'STORAGE-TOKEN-456' },
      learning: 'LEARNING-DATA-789',
    };
    const list: ExtensionInfoDto[] = [
      {
        ...extensionInfo('acme.sql', {
          diagnostics: [
            {
              code: 'manifest-invalid',
              data: { issues: ['x'], ...smuggled } as unknown as Record<
                string,
                never
              >,
            },
          ],
        }),
        ...smuggled,
      } as ExtensionInfoDto,
    ];
    const diagnostics = {
      ...diagnosticsDto({
        extensions: [{ ...health('acme.sql', { failures: 1 }), ...smuggled }],
      }),
      ...smuggled,
    } as ExtensionsDiagnosticsDto;
    const app = { ...input().app, ...smuggled };
    const engine = { ...input().engine, ...smuggled };

    const text = diagnosticsReport({
      app,
      engine,
      diagnostics,
      extensions: list,
    });

    for (const secret of [
      'libraryRoot',
      'secret-library-root',
      'settingValues',
      'SETTING-VALUE-123',
      'storage',
      'STORAGE-TOKEN-456',
      'LEARNING-DATA-789',
      'secret issue',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain('diagnostics: manifest-invalid');
  });
});

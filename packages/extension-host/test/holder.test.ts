import { EMPTY_SERVER_REGISTRATION } from '@dolphy-app/extension-api';
import type { ServerRegistration } from '@dolphy-app/extension-api';
import { describe, expect, it } from 'vitest';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import type { ExtensionRegistrationResult } from '../src/protocol.ts';
import { candidateOf } from './helpers.ts';

const type = (id: string, specSchema: Record<string, unknown> = {}) => ({
  id,
  title: null,
  specSchema,
  answerSchema: {},
});

const registered = (
  registration: Partial<ServerRegistration>,
): ExtensionRegistrationResult => ({
  ok: true,
  registration: { ...EMPTY_SERVER_REGISTRATION, ...registration },
});

const command = (id: string) => ({
  id,
  title: id,
  description: null,
  category: null,
  palette: true,
  icon: 'puzzle' as const,
  keybindings: [],
  when: null,
});

describe('createDiscoveryHolder', () => {
  it('кандидаты без регистраций действуют с пустыми вкладами', () => {
    const holder = createDiscoveryHolder(
      discoveryOf([candidateOf('acme.a'), candidateOf('acme.b')]),
    );
    const snapshot = holder.get();
    expect(snapshot.extensions.map(({ id }) => id)).toEqual([
      'acme.a',
      'acme.b',
    ]);
    expect(snapshot.candidates.map(({ id }) => id)).toEqual([
      'acme.a',
      'acme.b',
    ]);
    expect(snapshot.extensions[0]).toMatchObject({
      exerciseTypes: [],
      commands: [],
      events: [],
    });
  });

  it('applyRegistrations собирает ResolvedExtension из кандидата и регистрации', () => {
    const holder = createDiscoveryHolder(discoveryOf([candidateOf('acme.a')]));
    const changed = holder.applyRegistrations({
      registrations: {
        'acme.a': registered({ exerciseTypes: [type('acme.a')] }),
      },
    });
    expect(changed).toBe(true);
    expect(holder.get().extensions).toMatchObject([
      { id: 'acme.a', version: '1.0.0', exerciseTypes: [{ id: 'acme.a' }] },
    ]);
  });

  it('те же регистрации не меняют снимок и оставляют тот же объект', () => {
    const holder = createDiscoveryHolder(discoveryOf([candidateOf('acme.a')]));
    const result = {
      registrations: {
        'acme.a': registered({ commands: [command('acme.a.run')] }),
      },
    };
    expect(holder.applyRegistrations(result)).toBe(true);
    const before = holder.get();
    expect(holder.applyRegistrations(structuredClone(result))).toBe(false);
    expect(holder.get()).toBe(before);
  });

  it('replace оставляет регистрацию расширению с тем же кодом и сбрасывает изменённому', () => {
    const holder = createDiscoveryHolder(
      discoveryOf([candidateOf('acme.a'), candidateOf('acme.b')]),
    );
    holder.applyRegistrations({
      registrations: {
        'acme.a': registered({ exerciseTypes: [type('acme.a')] }),
        'acme.b': registered({ exerciseTypes: [type('acme.b')] }),
      },
    });
    holder.replace(
      discoveryOf([
        candidateOf('acme.a'),
        candidateOf('acme.b', { revision: 'r2' }),
      ]),
    );
    const [a, b] = holder.get().extensions;
    expect(a?.exerciseTypes).toHaveLength(1);
    expect(b?.exerciseTypes).toEqual([]);
  });

  it('replace сбрасывает регистрации до пустых, если код сменился', () => {
    const holder = createDiscoveryHolder(discoveryOf([candidateOf('acme.a')]));
    holder.applyRegistrations({
      registrations: {
        'acme.a': registered({ exerciseTypes: [type('acme.a')] }),
      },
    });
    holder.replace(discoveryOf([candidateOf('acme.a', { version: '1.0.1' })]));
    expect(holder.get().extensions[0]?.exerciseTypes).toEqual([]);
  });

  it('отказ регистрации убирает расширение и даёт load-failed', () => {
    const holder = createDiscoveryHolder(
      discoveryOf([candidateOf('acme.a', { origin: 'dev' })]),
    );
    holder.applyRegistrations({
      registrations: { 'acme.a': { ok: false, error: 'boom' } },
    });
    const snapshot = holder.get();
    expect(snapshot.extensions).toEqual([]);
    expect(snapshot.candidates.map(({ id }) => id)).toEqual(['acme.a']);
    expect(snapshot.diagnostics).toEqual([
      {
        extensionId: 'acme.a',
        origin: 'dev',
        diagnostic: { code: 'load-failed', data: { reason: 'boom' } },
      },
    ]);
  });

  it('диагностики обнаружения сохраняются рядом с отказами регистрации', () => {
    const holder = createDiscoveryHolder({
      extensions: [candidateOf('acme.a')],
      diagnostics: [
        {
          extensionId: 'acme.broken',
          origin: 'user',
          diagnostic: { code: 'manifest-invalid', data: { issues: ['bad'] } },
        },
      ],
      overridden: [],
    });
    holder.applyRegistrations({
      registrations: { 'acme.a': { ok: false, error: 'boom' } },
    });
    expect(
      holder.get().diagnostics.map(({ extensionId }) => extensionId),
    ).toEqual(['acme.broken', 'acme.a']);
  });

  it('кандидат, которого нет в ответе, остаётся с пустой регистрацией', () => {
    const holder = createDiscoveryHolder(
      discoveryOf([candidateOf('acme.a'), candidateOf('acme.b')]),
    );
    holder.applyRegistrations({
      registrations: {
        'acme.a': registered({ exerciseTypes: [type('acme.a')] }),
      },
    });
    expect(holder.get().extensions.map(({ id }) => id)).toEqual([
      'acme.a',
      'acme.b',
    ]);
    expect(holder.get().extensions[1]?.exerciseTypes).toEqual([]);
  });

  it.each([
    ['exerciseType', { exerciseTypes: [type('acme.a.t')] }],
    ['gradePolicy', { gradePolicies: [{ id: 'acme.a.p', label: 'P' }] }],
    ['command', { commands: [command('acme.a.run')] }],
    [
      'schedule',
      { schedules: [{ id: 'acme.a.s', every: 'hourly' as const, at: null }] },
    ],
    [
      'exporter',
      {
        exporters: [{ id: 'acme.a.e', title: 'E', scope: 'progress' as const }],
      },
    ],
  ])(
    'одно и то же имя (%s) у двух расширений: выигрывает первое',
    (kind, reg) => {
      const holder = createDiscoveryHolder(
        discoveryOf([candidateOf('acme.a'), candidateOf('acme.a.b')]),
      );
      const registration = registered(reg);
      holder.applyRegistrations({
        registrations: { 'acme.a': registration, 'acme.a.b': registration },
      });
      const snapshot = holder.get();
      expect(snapshot.extensions.map(({ id }) => id)).toEqual(['acme.a']);
      expect(snapshot.diagnostics).toMatchObject([
        {
          extensionId: 'acme.a.b',
          diagnostic: { code: 'claim-clash', data: { kind, by: 'acme.a' } },
        },
      ]);
    },
  );

  it('разные имена у двух расширений не конфликтуют', () => {
    const holder = createDiscoveryHolder(
      discoveryOf([candidateOf('acme.a'), candidateOf('acme.a.b')]),
    );
    holder.applyRegistrations({
      registrations: {
        'acme.a': registered({ exerciseTypes: [type('acme.a.one')] }),
        'acme.a.b': registered({ exerciseTypes: [type('acme.a.b.two')] }),
      },
    });
    expect(holder.get().extensions).toHaveLength(2);
    expect(holder.get().diagnostics).toEqual([]);
  });

  it('вид с несжимаемой схемой отвергает расширение целиком', () => {
    const holder = createDiscoveryHolder(discoveryOf([candidateOf('acme.a')]));
    holder.applyRegistrations({
      registrations: {
        'acme.a': registered({
          exerciseTypes: [type('acme.a', { type: 'nonsense' })],
          commands: [command('acme.a.run')],
        }),
      },
    });
    expect(holder.get().extensions).toEqual([]);
    expect(holder.get().diagnostics).toMatchObject([
      {
        extensionId: 'acme.a',
        diagnostic: {
          code: 'load-failed',
          data: { reason: expect.stringContaining("exercise type 'acme.a'") },
        },
      },
    ]);
  });
});

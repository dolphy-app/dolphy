import { describe, expect, it } from 'vitest';
import { holderOf } from './helpers.ts';
import type { ExtensionOrigin, ResolvedExtension } from '../src/discover.ts';
import { createExtensionPolicy } from '../src/policy.ts';

const extension = (id: string, origin: ExtensionOrigin): ResolvedExtension => ({
  id,
  version: '1.0.0',
  origin,
  revision: '',
  dir: `/x/${id}`,
  mainPath: null,
  permissions: [],
  name: null,
  description: null,
  author: null,
  dependencies: [],
  platforms: [],
  minAppVersion: null,
  icon: null,
  tags: [],
  install: null,
  messages: {},
  warnings: [],
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  widgets: [],
  schedules: [],
  panels: [],
  importers: [],
  exporters: [],
});

const policyFor = (...items: ResolvedExtension[]) =>
  createExtensionPolicy(holderOf(items));

describe('createExtensionPolicy', () => {
  it('до update ничего не отключено; не из поставки — изолировано', () => {
    const policy = policyFor(
      extension('dolphy.sql', 'bundled'),
      extension('acme.u', 'user'),
      extension('acme.d', 'dev'),
    );
    expect(policy.isEnabled('acme.u')).toBe(true);
    expect(policy.isIsolated('dolphy.sql')).toBe(false);
    expect(policy.isIsolated('acme.u')).toBe(true);
    expect(policy.isIsolated('acme.d')).toBe(true);
  });

  it('неизвестный id — включён и изолирован', () => {
    const policy = policyFor();
    expect(policy.isEnabled('nope')).toBe(true);
    expect(policy.isIsolated('nope')).toBe(true);
  });

  it('disabled и trusted действуют сразу и заменяют прежние настройки', () => {
    const policy = policyFor(extension('acme.u', 'user'));
    policy.update({
      disabled: ['acme.u'],
      trusted: ['acme.u'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    expect(policy.isEnabled('acme.u')).toBe(false);
    expect(policy.isIsolated('acme.u')).toBe(false);
    policy.update({
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    expect(policy.isEnabled('acme.u')).toBe(true);
    expect(policy.isIsolated('acme.u')).toBe(true);
  });

  it('расширение из поставки не изолируется и не отключается даже из настроек', () => {
    const policy = policyFor(extension('dolphy.sql', 'bundled'));
    policy.update({
      disabled: ['dolphy.sql'],
      trusted: ['dolphy.sql'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    expect(policy.isIsolated('dolphy.sql')).toBe(false);
    expect(policy.isEnabled('dolphy.sql')).toBe(true);
  });

  it('пользовательская копия id из поставки — обычное пользовательское расширение', () => {
    // обнаружение оставило в `extensions` только победителя
    const policy = policyFor(extension('dolphy.sql', 'user'));
    expect(policy.isIsolated('dolphy.sql')).toBe(true);
    policy.update({
      disabled: ['dolphy.sql'],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    expect(policy.isEnabled('dolphy.sql')).toBe(false);
  });

  describe('безопасный режим', () => {
    const settings = (safeMode: boolean) => ({
      disabled: [],
      trusted: ['acme.d'],
      checkUpdates: true,
      safeMode,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    const items = [
      extension('dolphy.sql', 'bundled'),
      extension('acme.u', 'user'),
      extension('acme.d', 'dev'),
    ];

    it('по умолчанию выключен', () => {
      expect(policyFor(...items).safeMode()).toBe(false);
    });

    it('настройка отключает всё не из поставки (пользовательские и dev), поставка работает', () => {
      const policy = policyFor(...items);
      policy.update(settings(true));
      expect(policy.safeMode()).toBe(true);
      expect(policy.isEnabled('acme.u')).toBe(false);
      expect(policy.isEnabled('acme.d')).toBe(false);
      expect(policy.isEnabled('dolphy.sql')).toBe(true);
      expect(policy.isIsolated('dolphy.sql')).toBe(false);
    });

    it('снятие настройки возвращает расширения сразу, доверие сохраняется', () => {
      const policy = policyFor(...items);
      policy.update(settings(true));
      policy.update(settings(false));
      expect(policy.safeMode()).toBe(false);
      expect(policy.isEnabled('acme.u')).toBe(true);
      expect(policy.isIsolated('acme.d')).toBe(false);
    });

    it('запуск с флагом не снимается настройкой', () => {
      const policy = createExtensionPolicy(holderOf(items), undefined, true);
      policy.update(settings(false));
      expect(policy.safeMode()).toBe(true);
      expect(policy.isEnabled('acme.u')).toBe(false);
      expect(policy.isEnabled('dolphy.sql')).toBe(true);
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { ExtensionOrigin, ResolvedExtension } from '../src/discover.ts';
import { createExtensionPolicy } from '../src/policy.ts';

const extension = (id: string, origin: ExtensionOrigin): ResolvedExtension => ({
  id,
  version: '1.0.0',
  origin,
  dir: `/x/${id}`,
  mainPath: null,
  permissions: [],
  name: null,
  description: null,
  author: null,
  platforms: [],
  minAppVersion: null,
  install: null,
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
});

const policyFor = (...items: ResolvedExtension[]) =>
  createExtensionPolicy({ extensions: items });

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
    });
    expect(policy.isEnabled('acme.u')).toBe(false);
    expect(policy.isIsolated('acme.u')).toBe(false);
    policy.update({ disabled: [], trusted: [], checkUpdates: true });
    expect(policy.isEnabled('acme.u')).toBe(true);
    expect(policy.isIsolated('acme.u')).toBe(true);
  });

  it('расширение из поставки не изолируется и не отключается даже из настроек', () => {
    const policy = policyFor(extension('dolphy.sql', 'bundled'));
    policy.update({
      disabled: ['dolphy.sql'],
      trusted: ['dolphy.sql'],
      checkUpdates: true,
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
    });
    expect(policy.isEnabled('dolphy.sql')).toBe(false);
  });
});

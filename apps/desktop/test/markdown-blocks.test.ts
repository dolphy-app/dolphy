// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import type { App, Component } from 'vue';
import { createI18n } from 'vue-i18n';
import { EXTENSION_CLIENTS_KEY } from '@/shared/lib/extension-clients.ts';
import { EXTENSION_APPS_KEY } from '@/shared/lib/extension-context.ts';
import { contextProbe, fakeApps } from './support/app-fakes.ts';
import type { ContextSeen } from './support/app-fakes.ts';
import type { ClientMarkdownRenderer } from '@/shared/lib/extension-clients.ts';
import MarkdownView from '@/shared/ui/MarkdownView.vue';
import { collectMarkdownBlocks } from '../src/shared/lib/markdown-blocks.ts';
import { createMarkdownRenderer } from '../src/shared/lib/markdown.ts';

const rendererOf = (
  component: Component,
  extensionId = 'dolphy.math',
  instance = 1,
): ClientMarkdownRenderer => ({
  kind: 'markdownRenderer',
  key: `${extensionId}:${instance}:1`,
  extensionId,
  language: 'math',
  component,
});

const mount = (source: string, languages = ['math']) => {
  const root = document.createElement('div');
  root.innerHTML = createMarkdownRenderer(new Set(languages))(source);
  return root;
};

describe('правило fence', () => {
  it('объявленный язык становится заглушкой с экранированным исходником', () => {
    const root = mount('```math\n<script>alert(1)</script> & x\n```');
    const block = root.querySelector('.dolphy-md-block');
    expect(block?.getAttribute('data-language')).toBe('math');
    expect(block?.getAttribute('data-state')).toBe('pending');
    expect(block?.querySelector('script')).toBeNull();
    expect(block?.querySelector('pre code')?.textContent).toBe(
      '<script>alert(1)</script> & x\n',
    );
  });

  it('необъявленный язык остаётся обычным кодом', () => {
    const root = mount('```other\nx\n```');
    expect(root.querySelector('.dolphy-md-block')).toBeNull();
    expect(root.querySelector('pre code')?.textContent).toBe('x\n');
  });

  it('дополнительные слова info-строки не мешают', () => {
    const root = mount('```math title="a"\nx\n```');
    expect(
      root.querySelector('.dolphy-md-block')?.getAttribute('data-language'),
    ).toBe('math');
  });
});

describe('collectMarkdownBlocks', () => {
  it('отдаёт заглушки с языком и исходником в порядке документа', () => {
    const root = mount('```math\nA\n```\n\ntext\n\n```math\nB & C\n```');
    const blocks = collectMarkdownBlocks(root);
    expect(blocks.map(({ language, source }) => [language, source])).toEqual([
      ['math', 'A\n'],
      ['math', 'B & C\n'],
    ]);
    expect(blocks[0]?.element).toBe(root.querySelector('.dolphy-md-block'));
  });
});

describe('MarkdownView: блоки компонентами расширения', () => {
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await nextTick();
  };
  const apps: App[] = [];
  afterEach(() => {
    for (const app of apps.splice(0)) app.unmount();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const Math = defineComponent({
    props: { source: { type: String, required: true }, language: String },
    render() {
      return h(
        'span',
        { 'data-testid': 'math' },
        `${this.language}:${this.source}`,
      );
    },
  });

  const mountView = async (
    source: string,
    renderers: ClientMarkdownRenderer[],
  ) => {
    const text = shallowRef(source);
    const registered = shallowRef(renderers);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({
      render: () => h(MarkdownView, { source: text.value, class: 'host' }),
    });
    app
      .provide(EXTENSION_APPS_KEY, fakeApps().apps)
      .provide(EXTENSION_CLIENTS_KEY, {
        markdownRenderers: registered,
      } as never)
      .use(
        createI18n({
          legacy: false,
          locale: 'en',
          messages: {
            en: { markdown: { renderFailed: 'Failed {language}' } },
          },
        }),
      );
    apps.push(app);
    const root = document.createElement('div');
    document.body.append(root);
    app.mount(root);
    await flush();
    return { root, text, registered };
  };

  it('компонент рисуется в месте блока, исходник скрыт состоянием', async () => {
    const { root } = await mountView('before\n\n```math\nx^2\n```\n\nafter', [
      rendererOf(Math),
    ]);
    const block = root.querySelector('.dolphy-md-block');
    expect(block?.querySelector('[data-testid="math"]')?.textContent).toBe(
      'math:x^2\n',
    );
    expect(block?.getAttribute('data-state')).toBe('done');
    expect(root.querySelector('.markdown')?.classList.contains('host')).toBe(
      true,
    );
  });

  it('компонент рендерера получает id своего расширения и его AppApi', async () => {
    const seen: ContextSeen = {};
    const { root } = await mountView('```math\nA\n```', [
      rendererOf(contextProbe(seen), 'acme.math'),
    ]);
    expect(root.querySelector('[data-testid="context-probe"]')).not.toBeNull();
    expect(seen.id).toBe('acme.math');
    expect(seen.app).toMatchObject({ locale: 'en' });
  });

  it('язык без рендерера остаётся обычным кодом, а появившийся рендерер рисует блок', async () => {
    const { root, registered } = await mountView('```math\nA\n```', []);
    expect(root.querySelector('.dolphy-md-block')).toBeNull();
    expect(root.querySelector('pre code')?.textContent).toBe('A\n');
    registered.value = [rendererOf(Math)];
    await flush();
    expect(root.querySelectorAll('[data-testid="math"]')).toHaveLength(1);
  });

  it('на язык берётся рендерер первого расширения реестра', async () => {
    const Other = defineComponent({
      render: () => h('span', { 'data-testid': 'other' }),
    });
    const { root } = await mountView('```math\nA\n```', [
      rendererOf(Math, 'acme.first'),
      rendererOf(Other, 'acme.second'),
    ]);
    expect(root.querySelector('[data-testid="math"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="other"]')).toBeNull();
  });

  it('сбой одного блока: заметка на его месте, остальной текст и блоки целы', async () => {
    const Broken = defineComponent({
      props: { source: { type: String, required: true } },
      setup(props) {
        if (props.source.startsWith('B')) throw new Error('boom');
        return () => h('span', { 'data-testid': 'math' }, props.source);
      },
    });
    const { root } = await mountView(
      'text\n\n```math\nA\n```\n\n```math\nB\n```',
      [rendererOf(Broken)],
    );
    const [ok, bad] = [...root.querySelectorAll('.dolphy-md-block')];
    expect(ok?.querySelector('[data-testid="math"]')).not.toBeNull();
    expect(bad?.getAttribute('data-state')).toBe('error');
    expect(bad?.querySelector('.dolphy-md-error')?.textContent).toContain(
      'math',
    );
    expect(bad?.querySelector('pre')).not.toBeNull();
    expect(root.querySelector('p')?.textContent).toBe('text');
  });

  it('новый source перерисовывает блок', async () => {
    const { root, text } = await mountView('```math\nA\n```', [
      rendererOf(Math),
    ]);
    text.value = '```math\nB\n```';
    await flush();
    const spans = root.querySelectorAll('[data-testid="math"]');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.textContent).toBe('math:B\n');
  });

  it('новый экземпляр рендерера (правка расширения) заменяет компонент блока и снимает ошибку', async () => {
    const Broken = defineComponent({
      setup() {
        throw new Error('boom');
      },
    });
    const { root, registered } = await mountView('```math\nA\n```', [
      rendererOf(Broken),
    ]);
    expect(
      root.querySelector('.dolphy-md-block')?.getAttribute('data-state'),
    ).toBe('error');
    registered.value = [rendererOf(Math, 'dolphy.math', 2)];
    await flush();
    expect(root.querySelectorAll('[data-testid="math"]')).toHaveLength(1);
    expect(
      root.querySelector('.dolphy-md-block')?.getAttribute('data-state'),
    ).toBe('done');
  });
});

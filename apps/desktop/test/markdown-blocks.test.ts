// @vitest-environment happy-dom
import type { MarkdownRendererDto } from '@dolphy-app/engine-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import type { App } from 'vue';
import { createI18n } from 'vue-i18n';
import { CONTRIBUTIONS_KEY } from '@/shared/api/engine/keys.ts';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import MarkdownView from '@/shared/ui/MarkdownView.vue';
import { collectMarkdownBlocks } from '../src/shared/lib/markdown-blocks.ts';
import { createMarkdownRenderer } from '../src/shared/lib/markdown.ts';

const loader = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/shared/lib/extension-component.ts', async (original) => ({
  ...(await original<typeof import('@/shared/lib/extension-component.ts')>()),
  importExtensionModule: (url: string) => loader.load(url),
}));

const renderers: MarkdownRendererDto[] = [
  {
    language: 'math',
    extensionId: 'dolphy.math',
    rendererUrl: 'dolphy-ext://m/a.mjs',
    origin: 'bundled',
    revision: '',
  },
];

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
    loader.load.mockReset();
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

  const mountView = async (source: string, revision = '') => {
    const text = shallowRef(source);
    const contributions = shallowRef({
      ...NO_CONTRIBUTIONS,
      markdownRenderers: renderers.map((r) => ({ ...r, revision })),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({
      render: () => h(MarkdownView, { source: text.value, class: 'host' }),
    });
    app.provide(CONTRIBUTIONS_KEY, contributions).use(
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
    return { root, text, contributions };
  };

  it('компонент рисуется в месте блока, исходник скрыт состоянием', async () => {
    loader.load.mockResolvedValue({ default: { markdown: { math: Math } } });
    const { root } = await mountView('before\n\n```math\nx^2\n```\n\nafter');
    const block = root.querySelector('.dolphy-md-block');
    expect(block?.querySelector('[data-testid="math"]')?.textContent).toBe(
      'math:x^2\n',
    );
    expect(block?.getAttribute('data-state')).toBe('done');
    expect(loader.load).toHaveBeenCalledWith('dolphy-ext://m/a.mjs');
    expect(root.querySelector('.markdown')?.classList.contains('host')).toBe(
      true,
    );
  });

  it('сбой одного блока: заметка на его месте, остальной текст и блоки целы', async () => {
    const Broken = defineComponent({
      props: { source: { type: String, required: true } },
      setup(props) {
        if (props.source.startsWith('B')) throw new Error('boom');
        return () => h('span', { 'data-testid': 'math' }, props.source);
      },
    });
    loader.load.mockResolvedValue({ default: { markdown: { math: Broken } } });
    const { root } = await mountView(
      'text\n\n```math\nA\n```\n\n```math\nB\n```',
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

  it('нет компонента языка в модуле — заметка об ошибке', async () => {
    loader.load.mockResolvedValue({ default: { markdown: {} } });
    const { root } = await mountView('```math\nA\n```');
    expect(root.querySelector('.dolphy-md-error')).not.toBeNull();
  });

  it('новый source перерисовывает блок', async () => {
    loader.load.mockResolvedValue({ default: { markdown: { math: Math } } });
    const { root, text } = await mountView('```math\nA\n```');
    text.value = '```math\nB\n```';
    await flush();
    const spans = root.querySelectorAll('[data-testid="math"]');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.textContent).toBe('math:B\n');
  });

  it('смена ревизии рендерера грузит модуль по новому адресу', async () => {
    loader.load.mockResolvedValue({ default: { markdown: { math: Math } } });
    const { root, contributions } = await mountView('```math\nA\n```', 'r1');
    expect(loader.load).toHaveBeenLastCalledWith('dolphy-ext://m/a.mjs?v=r1');
    contributions.value = {
      ...contributions.value,
      markdownRenderers: renderers.map((r) => ({ ...r, revision: 'r2' })),
    };
    await flush();
    expect(loader.load).toHaveBeenLastCalledWith('dolphy-ext://m/a.mjs?v=r2');
    expect(root.querySelectorAll('[data-testid="math"]')).toHaveLength(1);
  });
});

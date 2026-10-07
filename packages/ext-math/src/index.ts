import { defineMarkdownRenderer } from '@dolphy-app/extension-sdk';
import type { ExtensionMarkdown } from '@dolphy-app/extension-sdk';
import { defineComponent, h } from 'vue';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import 'mathjax-full/js/input/tex/noerrors/NoErrorsConfiguration.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';

const createConverter = () => {
  const adaptor = liteAdaptor();
  // eslint-disable-next-line new-cap -- функция MathJax
  RegisterHTMLHandler(adaptor);
  const document = mathjax.document('', {
    InputJax: new TeX({ packages: ['base', 'ams', 'noundefined', 'noerrors'] }),
    OutputJax: new SVG({ fontCache: 'none' }),
  });
  return (tex: string): string => {
    const node = document.convert(tex, { display: true });
    return adaptor.innerHTML(node);
  };
};

const holder: { convert?: (tex: string) => string } = {};

const MathBlock = defineComponent({
  name: 'MathBlock',
  props: {
    source: { type: String, required: true },
    language: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const tex = props.source.trim();
      if (tex === '') throw new Error('empty formula');
      holder.convert ??= createConverter();
      return h('div', {
        class: 'dolphy-math',
        role: 'math',
        'aria-label': tex,
        style:
          'display:block;text-align:center;max-width:100%;overflow-x:auto;',
        innerHTML: holder.convert(props.source),
      });
    };
  },
});

export const markdown = {
  math: defineMarkdownRenderer(MathBlock),
} satisfies ExtensionMarkdown;

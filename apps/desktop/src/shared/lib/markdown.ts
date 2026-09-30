import MarkdownIt from 'markdown-it';

// html: false — сырой HTML из материалов курса не попадает в страницу
const markdown = new MarkdownIt({ html: false, linkify: false });

// прокручиваемый блок кода должен получать фокус, иначе с клавиатуры его
// не прокрутить (axe `scrollable-region-focusable`)
for (const rule of ['fence', 'code_block'] as const) {
  const render = markdown.renderer.rules[rule];
  if (!render) throw new Error(`markdown-it has no "${rule}" rule`);
  markdown.renderer.rules[rule] = (...args) =>
    render(...args).replace('<pre', '<pre tabindex="0"');
}

export const renderMarkdown = (source: string) => markdown.render(source);

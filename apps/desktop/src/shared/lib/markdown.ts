import MarkdownIt from 'markdown-it';

// html: false — сырой HTML из материалов курса не попадает в страницу
const markdown = new MarkdownIt({ html: false, linkify: false });

export const renderMarkdown = (source: string) => markdown.render(source);

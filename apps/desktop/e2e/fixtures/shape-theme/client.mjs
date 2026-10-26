export const client = (c) => {
  c.addTheme({
    id: 'acme.shape',
    label: { en: 'Shape', ru: 'Форма' },
    dark: false,
    colors: { background: '#FFFFFF', surface: '#FFFFFF', primary: '#171717' },
    tokens: {
      'radius-sm': '1px',
      'radius-md': '3px',
      'radius-lg': '13px',
      'radius-xl': '23px',
      'font-family': "'Courier New', monospace",
    },
    css: 'body{letter-spacing:0.5px}',
  });
};

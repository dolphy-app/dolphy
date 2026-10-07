export const client = (c) => {
  c.addTheme({
    id: 'acme.midnight',
    label: { en: 'Midnight', ru: 'Полночь' },
    dark: true,
    colors: {
      background: '#101820',
      surface: '#1B2733',
      primary: '#FFB000',
      'on-primary': '#101820',
    },
  });
};

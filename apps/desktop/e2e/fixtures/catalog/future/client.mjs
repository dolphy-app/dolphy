export const client = (c) => {
  c.addTheme({
    id: 'acme.future',
    label: 'Будущее',
    dark: true,
    colors: {
      background: '#0B1020',
      surface: '#141B30',
      primary: '#7DD3FC',
      'on-primary': '#0B1020',
    },
  });
};

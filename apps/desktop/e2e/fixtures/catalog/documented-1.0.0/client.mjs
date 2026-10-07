export const client = (c) => {
  c.addTheme({
    id: 'acme.documented',
    label: 'Документ',
    dark: false,
    colors: {
      background: '#F5F7FF',
      surface: '#FFFFFF',
      primary: '#1D4ED8',
      'on-primary': '#FFFFFF',
    },
  });
};

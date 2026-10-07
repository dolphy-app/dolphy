export const client = (c) => {
  c.addTheme({
    id: 'acme.windows-only',
    label: 'Окна',
    dark: false,
    colors: {
      background: '#FFF4E5',
      surface: '#FFFFFF',
      primary: '#C2410C',
      'on-primary': '#FFFFFF',
    },
  });
};

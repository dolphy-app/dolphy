export const client = (c) => {
  c.addTheme({
    id: 'acme.hostile-readme',
    label: 'Враждебный',
    dark: false,
    colors: {
      background: '#FFF4E5',
      surface: '#FFFFFF',
      primary: '#C2410C',
      'on-primary': '#FFFFFF',
    },
  });
};

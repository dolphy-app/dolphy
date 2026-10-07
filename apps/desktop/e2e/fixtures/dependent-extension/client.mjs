export const client = (c) => {
  c.addTheme({
    id: 'acme.dawn',
    label: 'Рассвет',
    dark: false,
    colors: {
      background: '#FFF4E0',
      surface: '#FFE8C2',
      primary: '#B34700',
      'on-primary': '#FFFFFF',
    },
  });
};

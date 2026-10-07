export const client = (c) => {
  c.addTheme({
    id: 'acme.sunset',
    label: 'Закат',
    dark: true,
    colors: {
      background: '#1C1018',
      surface: '#2A1A24',
      primary: '#FB923C',
      'on-primary': '#1C1018',
    },
  });
};

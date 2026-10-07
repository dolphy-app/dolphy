export const client = (c) => {
  c.addTheme({
    id: 'acme.needy',
    label: 'Нуждающаяся',
    dark: false,
    colors: {
      background: '#F4F4FF',
      surface: '#E4E4FF',
      primary: '#3030B0',
      'on-primary': '#FFFFFF',
    },
  });
};

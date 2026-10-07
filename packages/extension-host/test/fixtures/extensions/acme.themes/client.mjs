export const client = (c) => {
  c.addTheme({
    id: 'acme.themes.night',
    label: 'Night',
    dark: true,
    colors: { background: '#101018', primary: '#8ab4f8' },
    variables: { 'border-opacity': 0.2 },
  });
};

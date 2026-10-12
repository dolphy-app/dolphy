import type { ThemeDefinition } from 'vuetify';

// голубой — фокус и обучение, бирюзовый — новое и освоенное,
// янтарный — закрепление основ; нейтральные поверхности с холодным голубоватым оттенком.
// Фирменный голубой #3B90F4 (иконка): под белый текст он даёт 3.24:1, поэтому
// primary — его более тёмный оттенок (≥ 4.5:1 на белом), а светлый берётся только для заливок без текста
export const LIGHT_THEME: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#F3F7FD',
    surface: '#FFFFFF',
    'surface-variant': '#E8F0FB',
    'on-surface-variant': '#566580',
    primary: '#0E6BDD',
    'on-primary': '#FFFFFF',
    // белый текст на чипе «Новое» и кнопках: #0D9488 давал 3.74:1, нужно 4.5:1
    secondary: '#0E7C72',
    'on-secondary': '#FFFFFF',
    error: '#DC2626',
    warning: '#D97706',
    // белый на янтарном давал ~3.2:1 (бейдж «Есть обновление»): тёмный текст ≥ 4.5:1
    'on-warning': '#1F1300',
    // белый на зелёном давал 3.30:1, на голубом 4.10:1 (заливка алерта набора расширений): тёмный текст ≥ 4.5:1
    success: '#16A34A',
    'on-success': '#04140A',
    info: '#0284C7',
    'on-info': '#00111C',
    // градиент акцентной карточки «плана дня»: белый текст ≥ 4.5:1
    'hero-start': '#1B6FD8',
    'hero-end': '#0A6FBF',
    // заливная кнопка на акцентной карточке
    'hero-contrast': '#FFFFFF',
  },
  // подзаголовки и подписи (`medium-emphasis`): 0.6 давало 4.29:1 на белом
  variables: {
    'border-color': '#0F2A4D',
    'border-opacity': 0.1,
    'medium-emphasis-opacity': 0.7,
  },
};

export const DARK_THEME: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#0B1424',
    surface: '#121D33',
    'surface-variant': '#1E2D4A',
    'on-surface-variant': '#9FB2D0',
    primary: '#52A8FF',
    'on-primary': '#0B1424',
    secondary: '#2DD4BF',
    'on-secondary': '#0B1424',
    // светлые заливки: белый по умолчанию давал 2.77:1 на красном (заливка алерта набора расширений), тёмный текст ≥ 4.5:1
    error: '#F87171',
    'on-error': '#0B1424',
    warning: '#FBBF24',
    'on-warning': '#1F1300',
    success: '#4ADE80',
    'on-success': '#0B1424',
    info: '#38BDF8',
    'on-info': '#0B1424',
    'hero-start': '#1D4FB8',
    'hero-end': '#1566B5',
    'hero-contrast': '#FFFFFF',
  },
  variables: { 'border-color': '#DCEBFF', 'border-opacity': 0.12 },
};

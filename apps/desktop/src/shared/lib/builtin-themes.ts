import type { ThemeDefinition } from 'vuetify';

// индиго — фокус и обучение, бирюзовый — новое и освоенное,
// янтарный — закрепление основ; нейтральные поверхности с холодным оттенком
export const LIGHT_THEME: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#F5F6FB',
    surface: '#FFFFFF',
    'surface-variant': '#ECEEF8',
    'on-surface-variant': '#5B6280',
    primary: '#4F46E5',
    'on-primary': '#FFFFFF',
    // белый текст на чипе «Новое» и кнопках: #0D9488 давал 3.74:1, нужно 4.5:1
    secondary: '#0E7C72',
    'on-secondary': '#FFFFFF',
    error: '#DC2626',
    warning: '#D97706',
    // белый на янтарном давал ~3.2:1 (бейдж «Есть обновление»): тёмный текст ≥ 4.5:1
    'on-warning': '#1F1300',
    success: '#16A34A',
    info: '#0284C7',
    // градиент акцентной карточки «плана дня»: белый текст ≥ 4.5:1
    'hero-start': '#4F46E5',
    'hero-end': '#7C3AED',
    // заливная кнопка на акцентной карточке
    'hero-contrast': '#FFFFFF',
  },
  // подзаголовки и подписи (`medium-emphasis`): 0.6 давало 4.29:1 на белом
  variables: {
    'border-color': '#1E1B4B',
    'border-opacity': 0.1,
    'medium-emphasis-opacity': 0.7,
  },
};

export const DARK_THEME: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#0E1020',
    surface: '#171A2F',
    'surface-variant': '#242845',
    'on-surface-variant': '#A5ACCB',
    primary: '#8B93FF',
    'on-primary': '#0E1020',
    secondary: '#2DD4BF',
    'on-secondary': '#0E1020',
    error: '#F87171',
    warning: '#FBBF24',
    'on-warning': '#1F1300',
    success: '#4ADE80',
    info: '#38BDF8',
    'hero-start': '#4338CA',
    'hero-end': '#6D28D9',
    'hero-contrast': '#FFFFFF',
  },
  variables: { 'border-color': '#E0E3FF', 'border-opacity': 0.12 },
};

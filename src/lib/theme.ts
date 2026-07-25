export type ThemeMode = 'dark' | 'light' | 'auto';

/** All available accent colors with name and hex */
export const THEME_COLORS = [
  { hex: '#0A84FF', name: 'Синий' },
  { hex: '#5E5CE6', name: 'Индиго' },
  { hex: '#BF5AF2', name: 'Фиолетовый' },
  { hex: '#FF2D55', name: 'Розовый' },
  { hex: '#FF375F', name: 'Красный' },
  { hex: '#FF9500', name: 'Оранжевый' },
  { hex: '#32D74B', name: 'Зелёный' },
  { hex: '#00C7BE', name: 'Бирюзовый' },
];

/**
 * Compute hover / light / border variants from a hex accent color.
 * Works for any valid #RRGGBB — no more manual if/else chain.
 */
function deriveAccentVars(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const darken = (v: number, amount: number) =>
    Math.max(0, Math.round(v - amount));

  const hover = `#${darken(r, 18).toString(16).padStart(2, '0')}${darken(g, 18).toString(16).padStart(2, '0')}${darken(b, 18).toString(16).padStart(2, '0')}`;

  return { hex, hover, light: `rgba(${r},${g},${b},0.10)`, border: `rgba(${r},${g},${b},0.20)` };
}

/** Apply accent color — sets 5 CSS custom properties on <html> */
export function applyTheme(color: string) {
  const v = deriveAccentVars(color);
  const el = document.documentElement.style;
  el.setProperty('--primary', v.hex);
  el.setProperty('--primary-hover', v.hover);
  el.setProperty('--primary-light', v.light);
  el.setProperty('--primary-border', v.border);
  el.setProperty('--primary-color', v.hex);
}

/**
 * Resolve 'auto' mode to concrete 'dark' | 'light' using system preference.
 */
export function getResolvedMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'auto') return mode;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

/**
 * Apply theme mode (dark / light / auto).
 * Sets `data-theme` attribute and `.dark` class on <html>,
 * updates <meta name="theme-color"> for PWA chrome.
 */
export function applyThemeMode(mode: ThemeMode) {
  const resolved = getResolvedMode(mode);
  const root = document.documentElement;

  root.setAttribute('data-theme', resolved);

  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  // PWA / browser chrome
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#020617' : '#ffffff');
  }
}

/**
 * Read saved theme settings from localStorage and apply them.
 * Returns the current color and mode for React state initialisation.
 */
export function loadThemeSettings(): { color: string; mode: ThemeMode } {
  const color = localStorage.getItem('synd_theme_color') || '#0A84FF';
  const mode = (localStorage.getItem('synd_theme_mode') as ThemeMode) || 'auto';

  applyTheme(color);
  applyThemeMode(mode);

  return { color, mode };
}

/** Persist and apply accent color */
export function setAccentColor(color: string) {
  localStorage.setItem('synd_theme_color', color);
  applyTheme(color);
}

/** Persist and apply theme mode */
export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem('synd_theme_mode', mode);
  applyThemeMode(mode);
}

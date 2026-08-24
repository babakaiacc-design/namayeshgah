import { useEffect, useState } from 'react';

export type ThemeName = 'simple' | 'unicorn';

export const THEMES: Array<{ name: ThemeName; label: string; description: string }> = [
  {
    name: 'simple',
    label: 'ساده',
    description: 'آرام و کم‌رنگ، مناسب استفادهٔ روزمره',
  },
  {
    name: 'unicorn',
    label: 'یونیکورن',
    description: 'صورتی و شاد، با آسمان آبنباتی',
  },
];

const STORAGE_KEY = 'exhibition-reminder:theme';

/** Browser chrome colour per theme, so the status bar matches the page. */
const THEME_COLORS: Record<ThemeName, { light: string; dark: string }> = {
  simple: { light: '#f5f7fb', dark: '#0c0f16' },
  unicorn: { light: '#fdeef5', dark: '#1a0f1c' },
};

export function readTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'simple' || stored === 'unicorn') return stored;
  } catch {
    // Private browsing on iOS can refuse storage access.
  }
  return 'simple';
}

/**
 * Puts the theme on the root element.
 *
 * Called once before React mounts, so the first paint is already themed. Doing
 * it inside a component would show the default theme for a frame and then flash
 * to the chosen one.
 */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;

  // matchMedia is missing in some embedded webviews and in jsdom, so its
  // presence is checked rather than assumed. Falling back to the light colour
  // is the safe default; a thrown error here would stop the theme applying at
  // all.
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const colour = THEME_COLORS[theme][prefersDark ? 'dark' : 'light'];

  // Both entries are updated because each is scoped to a colour scheme, and the
  // browser picks whichever matches.
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((tag) => tag.setAttribute('content', colour));
}

export function storeTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignored */
  }
}

export function useTheme(): [ThemeName, (next: ThemeName) => void] {
  const [theme, setThemeState] = useState<ThemeName>(readTheme);

  // Keeps other tabs, and any other component reading the theme, in step.
  useEffect(() => {
    const sync = () => setThemeState(readTheme());
    window.addEventListener('storage', sync);
    window.addEventListener('theme-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('theme-changed', sync);
    };
  }, []);

  const setTheme = (next: ThemeName) => {
    storeTheme(next);
    applyTheme(next);
    setThemeState(next);
    window.dispatchEvent(new CustomEvent('theme-changed'));
  };

  return [theme, setTheme];
}

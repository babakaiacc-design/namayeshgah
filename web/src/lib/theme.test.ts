import { beforeEach, describe, expect, it } from 'vitest';

import { THEMES, applyTheme, readTheme, storeTheme } from './theme';

const KEY = 'exhibition-reminder:theme';

describe('theme selection', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('defaults to the simple theme', () => {
    expect(readTheme()).toBe('simple');
  });

  it('remembers a stored choice', () => {
    storeTheme('unicorn');
    expect(readTheme()).toBe('unicorn');
  });

  it('falls back when the stored value is not a theme', () => {
    // A stale or hand-edited value must not leave the app with an unknown
    // data-theme and therefore no palette at all.
    localStorage.setItem(KEY, 'rainbow');
    expect(readTheme()).toBe('simple');
  });

  it('puts the theme on the root element', () => {
    applyTheme('unicorn');
    expect(document.documentElement.dataset.theme).toBe('unicorn');

    applyTheme('simple');
    expect(document.documentElement.dataset.theme).toBe('simple');
  });

  it('updates the browser chrome colour to match', () => {
    const tag = document.createElement('meta');
    tag.setAttribute('name', 'theme-color');
    document.head.appendChild(tag);

    applyTheme('unicorn');
    const unicorn = tag.getAttribute('content');

    applyTheme('simple');
    const simple = tag.getAttribute('content');

    expect(unicorn).toBeTruthy();
    expect(simple).toBeTruthy();
    expect(unicorn).not.toBe(simple);

    tag.remove();
  });

  it('offers exactly the two themes the product defines', () => {
    expect(THEMES.map((theme) => theme.name)).toEqual(['simple', 'unicorn']);
  });
});

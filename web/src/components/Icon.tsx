import type { ReactElement } from 'react';

/**
 * Vector icon set.
 *
 * Replaces the text glyphs the first version used. Glyphs such as ⌂ and ▤
 * render differently on every platform, cannot be sized or coloured from
 * design tokens, and are the single clearest tell of an unpolished interface.
 *
 * All paths are drawn on a 24 grid with one stroke width, so the whole set
 * shares an optical weight. Size comes from tokens rather than arbitrary
 * numbers, and the icon is hidden from assistive technology unless it is given
 * a label, because a decorative icon beside visible text should not be read out
 * twice.
 */

export type IconName =
  | 'home'
  | 'calendar'
  | 'search'
  | 'heart'
  | 'heart-filled'
  | 'user'
  | 'pin'
  | 'clock'
  | 'bell'
  | 'check'
  | 'alert'
  | 'link'
  | 'share'
  | 'chevron-start'
  | 'chevron-end'
  | 'tag'
  | 'sparkle';

const PATHS: Record<IconName, ReactElement> = {
  home: (
    <>
      <path d="M3.5 10.7 12 3.8l8.5 6.9" />
      <path d="M5.8 9.6V19a1.5 1.5 0 0 0 1.5 1.5h9.4A1.5 1.5 0 0 0 18.2 19V9.6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <path d="M8.5 3.5v4M15.5 3.5v4M3.5 10.5h17" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.7-7.5-9.8A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.8C19.5 15.3 12 20 12 20Z" />,
  'heart-filled': (
    <path
      d="M12 20s-7.5-4.7-7.5-9.8A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.8C19.5 15.3 12 20 12 20Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.8 20.2c0-3.6 3.2-5.6 7.2-5.6s7.2 2 7.2 5.6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 20.5s6.5-5.4 6.5-10.3a6.5 6.5 0 1 0-13 0C5.5 15.1 12 20.5 12 20.5Z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.1 2" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9.2a6 6 0 1 0-12 0c0 6-2.6 7.3-2.6 7.3h17.2S18 15.2 18 9.2Z" />
      <path d="M13.8 20.2a2.1 2.1 0 0 1-3.6 0" />
    </>
  ),
  check: <path d="m4.8 12.6 4.7 4.7L19.2 7.4" />,
  alert: (
    <>
      <path d="M12 4.2 21 19.4H3L12 4.2Z" />
      <path d="M12 10v4M12 17.2v.01" />
    </>
  ),
  link: (
    <>
      <path d="M13.5 5.5h5v5" />
      <path d="M18.5 5.5 11 13" />
      <path d="M18 14v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h4.5" />
    </>
  ),
  share: (
    <>
      <path d="M12 3.8v11" />
      <path d="m8.2 7.4 3.8-3.6 3.8 3.6" />
      <path d="M5.5 13.5v5.2a1.8 1.8 0 0 0 1.8 1.8h9.4a1.8 1.8 0 0 0 1.8-1.8v-5.2" />
    </>
  ),
  // Direction is expressed as start/end rather than left/right, because the
  // app is RTL and "previous" sits on the opposite side from a Latin layout.
  'chevron-start': <path d="m14.5 5.5 7 6.5-7 6.5" />,
  'chevron-end': <path d="M9.5 5.5 2.5 12l7 6.5" />,
  tag: (
    <>
      <path d="M4.5 11.3V5.8a1.3 1.3 0 0 1 1.3-1.3h5.5l8 8-6.8 6.8-8-8Z" />
      <circle cx="8.6" cy="8.6" r="1.3" />
    </>
  ),
  sparkle: (
    <path d="M12 4.2 13.6 9l4.8 1.6-4.8 1.6L12 17l-1.6-4.8L5.6 10.6 10.4 9 12 4.2Z" />
  ),
};

export interface IconProps {
  name: IconName;
  /** Matches the icon size tokens rather than an arbitrary pixel value. */
  size?: 'sm' | 'md' | 'lg';
  /** Supply only when the icon carries meaning on its own. */
  label?: string;
  className?: string;
}

const SIZES = { sm: 16, md: 20, lg: 24 } as const;

export function Icon({ name, size = 'md', label, className }: IconProps) {
  const dimension = SIZES[size];

  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={dimension}
      height={dimension}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

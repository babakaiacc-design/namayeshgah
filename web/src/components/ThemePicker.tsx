import { Icon } from './Icon';
import { THEMES, useTheme } from '../lib/theme';

/**
 * Theme chooser.
 *
 * Each option shows a swatch of its own palette rather than only a name,
 * because "unicorn" and "simple" describe a mood the user cannot picture until
 * they see it. Choosing applies immediately, so the picker itself is the
 * preview.
 */
export function ThemePicker() {
  const [theme, setTheme] = useTheme();

  return (
    <div className="theme-picker" role="group" aria-label="انتخاب پوسته">
      {THEMES.map((option) => {
        const active = theme === option.name;

        return (
          <button
            key={option.name}
            type="button"
            className="theme-option"
            aria-pressed={active}
            onClick={() => setTheme(option.name)}
          >
            <span
              className={`theme-option__swatch theme-option__swatch--${option.name}`}
              aria-hidden="true"
            />
            <span className="theme-option__head">
              {option.label}
              {active && <Icon name="check" size="sm" label="انتخاب‌شده" />}
            </span>
            <p className="theme-option__desc">{option.description}</p>
          </button>
        );
      })}
    </div>
  );
}

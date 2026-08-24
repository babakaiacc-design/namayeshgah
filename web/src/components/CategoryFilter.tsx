import { useState } from 'react';

import type { CategoryNode } from '../api/types';
import { Icon } from './Icon';
import { toPersianDigits } from '../lib/persian-date';

interface Props {
  categories: CategoryNode[];
  selected?: string;
  onSelect: (slug: string | undefined) => void;
}

/** How many chips stay visible before the list is collapsed. */
const COLLAPSED_COUNT = 5;

/**
 * Category filter chips.
 *
 * These used to sit in a horizontally scrolling strip with the scrollbar
 * hidden, which left no signal at all that more options existed past the edge:
 * no arrow, no fade, no scrollbar. Adding an indicator would have treated the
 * symptom. The row wraps instead, so nothing is off screen and the control
 * behaves identically with touch, mouse and keyboard.
 *
 * Wrapping every chip would push the results far down the page, so the list
 * collapses to one short row with an explicit toggle. A visible "show more"
 * control is an affordance; a silent scroll edge is not.
 */
export function CategoryFilter({ categories, selected, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? categories : categories.slice(0, COLLAPSED_COUNT);
  const hiddenCount = categories.length - visible.length;

  // A selected category must never be the one hidden behind the toggle,
  // otherwise the active filter would be invisible.
  const selectedIsHidden =
    Boolean(selected) && !visible.some((category) => category.slug === selected);
  const shown = selectedIsHidden
    ? [...visible, categories.find((category) => category.slug === selected)!]
    : visible;

  return (
    <div className="filter">
      <div className="filter__chips" role="group" aria-label="فیلتر دسته‌بندی">
        <button
          type="button"
          className={`chip${selected === undefined ? ' chip--active' : ''}`}
          aria-pressed={selected === undefined}
          onClick={() => onSelect(undefined)}
        >
          همه
        </button>

        {shown.map((category) => {
          const active = selected === category.slug;
          return (
            <button
              key={category.slug}
              type="button"
              className={`chip${active ? ' chip--active' : ''}`}
              aria-pressed={active}
              onClick={() => onSelect(active ? undefined : category.slug)}
            >
              {category.nameFa}
              {category.exhibitionCount > 0 && (
                <span className="chip__count">{toPersianDigits(category.exhibitionCount)}</span>
              )}
            </button>
          );
        })}

        {hiddenCount > 0 && !expanded && (
          <button
            type="button"
            className="chip chip--toggle"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
          >
            {toPersianDigits(hiddenCount)} مورد دیگر
            <Icon name="chevron-end" size="sm" />
          </button>
        )}

        {expanded && (
          <button
            type="button"
            className="chip chip--toggle"
            onClick={() => setExpanded(false)}
            aria-expanded
          >
            بستن
            <Icon name="chevron-start" size="sm" />
          </button>
        )}
      </div>
    </div>
  );
}

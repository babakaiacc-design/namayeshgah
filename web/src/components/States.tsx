interface EmptyProps {
  title: string;
  hint?: string;
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" />
      ))}
      <span className="sr-only">در حال بارگذاری</span>
    </div>
  );
}

export function Empty({ title, hint }: EmptyProps) {
  return (
    <div className="state">
      <p className="state__title">{title}</p>
      {hint && <p className="state__hint">{hint}</p>}
    </div>
  );
}

/**
 * Error state.
 *
 * The free instance sleeps and takes about a minute to wake, so a failure is
 * far more often a cold start than a real outage. The wording says that rather
 * than blaming the user connection.
 */
export function Failed({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="state">
      <p className="state__title">در دریافت اطلاعات مشکلی پیش آمد</p>
      <p className="state__hint">
        ممکن است سرور در حال بیدار شدن باشد. چند لحظه دیگر دوباره تلاش کنید.
      </p>
      {onRetry && (
        <button type="button" className="badge badge--category" onClick={onRetry}>
          تلاش دوباره
        </button>
      )}
    </div>
  );
}

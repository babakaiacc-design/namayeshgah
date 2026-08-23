import { useEffect, useState } from 'react';

/**
 * Profile, and the honest explanation of how reminders can work on the web.
 *
 * The web has no reliable local scheduled notification API: Notification
 * Triggers never left the experimental stage and does not exist in Safari at
 * all. So a reminder that fires while the app is closed can only come from a
 * server push, and on iOS that requires the app to be installed to the Home
 * Screen. Rather than hiding that behind a switch that silently does nothing,
 * this screen says what will and will not happen on the current device.
 */

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports as a Mac, distinguishable only by touch support.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari uses a non-standard flag on the navigator instead.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function ProfilePage() {
  const [installed, setInstalled] = useState(isStandalone);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const update = () => setInstalled(isStandalone());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const ios = isIos();
  const pushPossible = permission !== 'unsupported' && (!ios || installed);

  const requestPermission = async () => {
    if (permission === 'unsupported') return;
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  return (
    <>
      <h1 className="page-title">پروفایل</h1>

      <section className="section">
        <h2 className="section__title">یادآوری‌ها</h2>

        <div className="panel">
          <p className="panel__lead">
            یادآوری‌های درون‌برنامه‌ای همیشه کار می‌کنند. هر بار که اپ را باز کنید،
            نمایشگاه‌های نزدیک را می‌بینید — بدون نیاز به هیچ مجوزی.
          </p>

          {permission === 'unsupported' && (
            <p className="panel__note">
              این مرورگر از اعلان پشتیبانی نمی‌کند. یادآوری‌ها فقط داخل اپ نمایش
              داده می‌شوند.
            </p>
          )}

          {ios && !installed && (
            <p className="panel__note">
              روی iOS، اعلان فقط زمانی کار می‌کند که اپ را به صفحهٔ اصلی اضافه
              کرده باشید. از منوی اشتراک‌گذاری سافاری گزینهٔ «Add to Home Screen»
              را بزنید و بعد از همان‌جا اپ را باز کنید.
            </p>
          )}

          {pushPossible && permission === 'default' && (
            <button type="button" className="action action--primary" onClick={() => void requestPermission()}>
              فعال‌سازی اعلان
            </button>
          )}

          {permission === 'granted' && (
            <p className="panel__note panel__note--ok">اعلان‌ها فعال هستند.</p>
          )}

          {permission === 'denied' && (
            <p className="panel__note">
              اعلان‌ها را رد کرده‌اید. برای فعال‌سازی باید از تنظیمات مرورگر
              اجازه دهید.
            </p>
          )}

          <p className="panel__note">
            توجه: تحویل اعلان روی وب تضمینی نیست و ممکن است چند دقیقه تأخیر
            داشته باشد. برای یادآوری دقیق، اپ را باز نگه دارید یا از نسخهٔ نصبی
            استفاده کنید.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">نصب روی گوشی</h2>
        <div className="panel">
          {installed ? (
            <p className="panel__note panel__note--ok">
              اپ روی صفحهٔ اصلی نصب شده است.
            </p>
          ) : (
            <p className="panel__lead">
              {ios
                ? 'در سافاری، دکمهٔ اشتراک‌گذاری را بزنید و «Add to Home Screen» را انتخاب کنید.'
                : 'از منوی مرورگر گزینهٔ «افزودن به صفحهٔ اصلی» یا «نصب برنامه» را بزنید.'}
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">دربارهٔ داده‌ها</h2>
        <div className="panel">
          <p className="panel__lead">
            تاریخ‌ها از منابع عمومی جمع‌آوری می‌شوند و هیچ تاریخی توسط اپ ساخته
            نمی‌شود. اگر منبعی تاریخی منتشر نکرده باشد، همان را می‌نویسیم؛ و اگر
            منابع اختلاف داشته باشند، هر دو را نشان می‌دهیم.
          </p>
          <p className="panel__note">
            پیش از هر برنامه‌ریزی، تاریخ را از برگزارکننده تأیید بگیرید.
          </p>
        </div>
      </section>
    </>
  );
}

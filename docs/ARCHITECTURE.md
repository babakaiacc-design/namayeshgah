# ARCHITECTURE.md

## ۱. نمای کلی

```
                    ┌──────────────────────────┐
                    │   GitHub Actions (cron)  │
                    │  زمان‌بند Sync + keepalive │
                    └────────────┬─────────────┘
                                 │ POST /internal/sync
                                 ▼
   منابع خارجی ──fetch──►  ┌───────────────────┐
   (eventro و ...)         │  Backend (Render) │──► Supabase Postgres
                           │      NestJS       │
   ┌──────────────┐        └─────────┬─────────┘
   │ Relay ایران   │──push──►         │ REST
   │ (فاز بعد)     │                  ▼
   └──────┬───────┘        ┌──────────────────┐   ┌──────────────┐
          │ fetch          │  Android (Kotlin) │   │ Admin (Next) │
          ▼                │   Room = کش آفلاین │   │   Vercel     │
   منابع مسدود ایرانی        └──────────────────┘   └──────────────┘
```

---

## ۲. چرا این تقسیم‌بندی

مسئلهٔ تعیین‌کننده در DATA_SOURCES.md توضیح داده شده: **مسدودی دوطرفه**. منابع رسمی ایرانی از بیرون در دسترس نیستند؛ منابع بین‌المللی از داخل ایران مسدودند.

اگر Backend داخل ایران میزبانی شود، همان روزی که بخواهیم بین‌المللی شویم به بن‌بست می‌خوریم — و کاربر خارجی هم API کند و بعضاً غیرقابل‌دسترس می‌گیرد.

پس: **Backend بیرون، و یک Relay سبک داخل ایران فقط برای fetch.**

Relay فقط اتصال **خروجی** دارد — Job را pull می‌کند و پاسخ خام را با امضای HMAC push می‌کند. نه IP عمومی می‌خواهد، نه پورت باز. اگر از کار بیفتاد بقیهٔ منابع سالم کار می‌کنند.

نکتهٔ کلیدی برای تمیزماندن: **Adapterها نمی‌دانند از کدام مسیر fetch می‌شوند.**

```ts
interface Fetcher {
  get(url: string, opts?: FetchOptions): Promise<RawResponse>;
}
// DirectFetcher | RelayFetcher — انتخاب از روی sources.fetch_mode
```

به همین دلیل Relay می‌تواند **بعداً** اضافه شود بدون دست‌زدن به حتی یک Adapter.

---

## ۳. زیرساخت رایگان و محدودیت‌هایش

| لایه | سرویس | محدودیت | راه مدیریت |
|---|---|---|---|
| DB | Supabase Free | ۵۰۰MB · pause بعد از ۷ روز بی‌کاری · اتصال کم | Pooler پورت `6543` + ping دوره‌ای |
| API | Render Free | ۵۱۲MB · خواب بعد از ۱۵ دقیقه · cold start حدود ۵۰ ثانیه | کش آفلاین موبایل + timeout سخاوتمند |
| Cron | GitHub Actions | — | جایگزین cron که Render رایگان ندارد |
| Admin | Vercel Free | — | — |
| Redis | **حذف در MVP** | Render رایگان ندارد | قفل و کش با Postgres |

### تلهٔ Pooler

Supabase Pooler در حالت **transaction** با prepared statement سازگار نیست. اگر تنظیم نشود، خطاهای گیج‌کنندهٔ «prepared statement already exists» می‌گیریم:

```ts
// backend/src/config/database.config.ts
{ extra: { prepare: false }, poolSize: 5 }
```

### چرا GitHub Actions

Render در پلن رایگان **نه Cron Job دارد نه Background Worker** (هر دو پولی‌اند). GitHub Actions هم رایگان است و هم یک تیر دو نشان:

1. Sync را طبق زمان‌بندی اجرا می‌کند
2. سرویس خوابیده را بیدار و Supabase را از pause دور نگه می‌دارد

---

## ۴. لایه‌بندی Backend

```
backend/src/
  common/       persian (نرمال‌سازی) · dates · http (fetcher، rate limit)
  config/       پیکربندی از env
  database/     migrations · seeds
  modules/      exhibitions · categories · venues · cities · countries
                users · auth · reminders · favorites · notifications
                sources · sync · admin · health
  ingestion/    adapters · normalizer · dedup · validation
```

قاعده: `modules/*` منطق محصول است، `ingestion/*` خط لولهٔ داده. Ingestion به Repository دسترسی دارد اما Controller ندارد — تنها ورودی‌اش `SyncService` است.

---

## ۵. خط لولهٔ Ingestion

```
Source Adapter → RawExhibition → Normalizer → Dedup → Validation → Canonical DB
                                                 │
                                                 └─► Review Queue (0.80–0.95)
```

### Adapter

```ts
interface ExhibitionSource {
  readonly name: string;
  readonly confidence: number;
  fetchExhibitions(ctx: SourceContext): Promise<RawExhibition[]>;
}
```

`RawExhibition` عمداً «کثیف» است — رشته‌های خام، تاریخ‌های احتمالاً نامعتبر. هیچ Adapterی حق پاک‌سازی ندارد؛ آن کار Normalizer است. این مرز باعث می‌شود Adapterها ساده و قابل تست بمانند.

### Normalizer

- نرمال‌سازی متن فارسی (بخش ۷)
- نگاشت مکان خام به `venue_id` / `city_id` از طریق جدول نام‌های مستعار
- نگاشت دستهٔ خام به `category_id`
- **بدون تبدیل تاریخ** — تاریخ میلادی مستقیم از منبع می‌آید (DATA_SOURCES بخش ۲)

### Dedup

امتیاز وزن‌دار ۰ تا ۱:

| سیگنال | وزن | یادداشت |
|---|---|---|
| شناسهٔ خارجی یکسان از همان منبع | قطعی | تطابق فوری |
| شباهت عنوان نرمال‌شده (در TypeScript) | 0.45 | زیر را بخوانید |
| همپوشانی تاریخ | 0.30 | |
| تطابق venue | 0.15 | |
| تطابق دسته | 0.10 | |

```
≥ 0.95      ادغام خودکار
0.80 تا 0.95  صف بازبینی ادمین
< 0.80      رویداد مجزا
```

**چرا امتیازدهی در TypeScript و نه `pg_trgm`:**

در تست واقعی مشخص شد `pg_trgm` به ctype دیتابیس وابسته است. روی کلاستر با locale برابر `C`:

```
show_trgm('نمایشگاه')  →  []          (خالی)
similarity(fa, fa)     →  0
'نما' ~ '^[[:alpha:]]+$'  →  false
```

یعنی ایندکس trigram روی عنوان فارسی **کاملاً خالی** می‌ماند. Supabase با locale یونیکد اجرا می‌شود و آنجا کار می‌کند — و همین بدترین حالت است: CI و production بی‌سروصدا نتیجهٔ متفاوت می‌دهند.

پس امتیاز شباهت در TypeScript محاسبه می‌شود (قطعی و مستقل از locale)، و ایندکس Full-Text فقط برای **کوچک‌کردن مجموعهٔ کاندید** استفاده می‌شود. افزونهٔ `pg_trgm` برای متن لاتین باقی می‌ماند.

به همین دلیل تابع `persian_normalize_search` هم به‌جای `[:alnum:]` از بازهٔ صریح code point استفاده می‌کند.

### Validation (بند ۴۵)

`title` الزامی · `startDate` کوچک‌تر یا مساوی `endDate` · `venue` و `city` معتبر · `sourceUrl` معتبر.
شکست اعتبارسنجی رکورد را **رد** می‌کند، نه اینکه با حدس پرش کند.

---

## ۶. عدم قطعیت به‌عنوان شهروند درجه‌یک

قانون سفت پروژه (بند ۵۸): **هیچ تاریخی از خودمان تولید نمی‌شود.**

```sql
date_status ENUM('CONFIRMED','UNKNOWN','CONFLICT','POSTPONED')
```

- منبع تاریخ نداد → `UNKNOWN`
- دو منبع اختلاف دارند → `CONFLICT` + هر دو رکورد در `exhibition_source_records` نگه داشته می‌شوند + ارجاع به ادمین
- هیچ‌کدام خودکار برنده نمی‌شود، **مگر** منبع رسمی یا برگزارکننده با confidence بالاتر

UI باید `UNKNOWN` و `CONFLICT` را صادقانه نشان دهد، نه اینکه تاریخی جعل کند.

---

## ۷. متن فارسی

یک ماژول واحد `common/persian` و **همه‌جا از همان استفاده شود** — هم موقع نوشتن در DB و هم موقع query:

- `ي` عربی به `ی` فارسی · `ك` به `ک`
- حذف اعراب و کشیده
- یکسان‌سازی نیم‌فاصله (ZWNJ)
- ارقام عربی و فارسی به لاتین برای ذخیره‌سازی

اگر نرمال‌سازی نوشتن و خواندن یکی نباشد، جستجو بی‌سروصدا شکست می‌خورد. به همین دلیل تابع نرمال‌سازی هم در TypeScript و هم به‌صورت تابع SQL تعریف می‌شود و `search_vector` از روی خروجی همان ساخته می‌شود.

---

## ۸. تاریخ و Timezone

- ذخیره: `DATE` میلادی (`start_date`, `end_date`)
- `cities.timezone` به‌صورت IANA (`Asia/Tehran`, `Asia/Dubai`)
- نمایش: تبدیل به شمسی **فقط در لایهٔ UI**
- هرگز تبدیل دستی تاریخ نوشته نشود — کتابخانهٔ معتبر استفاده شود

**چرا timezone حیاتی است:** «۱ روز قبل، ساعت ۹ صبح» برای نمایشگاه دبی باید در وقت محلی درست شلیک کند. لحظهٔ Reminder از ترکیب تاریخ محلی رویداد و timezone شهر محاسبه می‌شود، نه از UTC خام. بدون این، فاز ۳ اعلان‌های اشتباه می‌دهد.

---

## ۹. Reminder

Reminderها **محلی** روی دستگاه شلیک می‌شوند (`AlarmManager`) — بدون وابستگی به Google یا شبکه، مطابق بند ۲۵.

سرور فقط منبع حقیقت برای *وجود* Reminder است تا بین دستگاه‌ها قابل sync باشد.

**بازمحاسبه پس از تغییر تاریخ (بند ۲۲):**

```
Sync تغییر startDate را تشخیص می‌دهد
   → ثبت در exhibition_changes
   → offset هر Reminder فعال حفظ می‌شود (مثلاً «۷ روز قبل»)
   → reminderDateTime دوباره محاسبه می‌شود
   → اعلان «تاریخ نمایشگاه تغییر کرد» به کاربر
   → اپ آلارم محلی را دوباره برنامه‌ریزی می‌کند
```

نکته: آنچه ذخیره می‌شود **offset** است نه فقط زمان مطلق — وگرنه بازمحاسبه ممکن نیست.

---

## ۱۰. Auth

```
مهمان (بدون ثبت‌نام)  →  دیدن، جستجو، فیلتر
حساب ناشناس دستگاه    →  Reminder و Favorite
Identity متصل‌شده      →  sync بین دستگاه‌ها
```

```sql
users            (id, anonymous_device_id, ...)
auth_identities  (id, user_id, provider, provider_uid)  -- google | otp | email
```

چرا این ترتیب: Google Sign-In در ایران معمولاً مسدود است و OTP پیامکی برای کاربر خارجی بی‌معنی است. حساب ناشناس **همه‌جا** کار می‌کند و مسیر ارتقا را باز می‌گذارد.

---

## ۱۱. کلاینت: PWA به‌جای اپ نیتیو

کلاینت یک **Progressive Web App** است که روی اندروید و iOS با یک کد اجرا می‌شود. اپ نیتیو اندروید کنار گذاشته شد.

```
web/
  src/lib/        تاریخ شمسی، ارقام فارسی، علاقه‌مندی‌ها
  src/api/        کلاینت REST
  src/components/ کارت و حالت‌ها
  src/features/   خانه · تقویم · جستجو · جزئیات · علاقه‌مندی · پروفایل
```

- Vite + React + TypeScript، خروجی استاتیک روی هاست رایگان
- RTL کامل با **CSS logical properties** — نه left/right دستی
- فونت وزیرمتن **self-host** شده، چون Google Fonts در ایران قابل اتکا نیست
- Service Worker با `StaleWhileRevalidate` روی `/api/` — هم آفلاین کار می‌کند و هم cold start رندر را پنهان می‌کند

### تاریخ شمسی بدون کتابخانه

`Intl.DateTimeFormat('fa-IR-u-ca-persian')` بومی مرورگر است و سال کبیسه را هم درست می‌دهد:

```
2026-08-31  →  ۹ شهریور ۱۴۰۵
```

جهت معکوس (شمسی به میلادی) با جستجوی محدود روی همان Intl انجام می‌شود، نه با پیاده‌سازی دستی تقویم — جایی که تبدیل‌کننده‌های دست‌ساز معمولاً اشتباه می‌کنند.

### محدودیت جدی: یادآوری روی وب

وب **هیچ API قابل اتکایی برای زمان‌بندی محلی اعلان ندارد**. `Notification Triggers` هرگز از حالت آزمایشی خارج نشد و در Safari وجود ندارد. پس:

| لایه | وضعیت |
|---|---|
| یادآوری درون‌برنامه‌ای | ✅ همیشه کار می‌کند، بدون مجوز |
| Web Push روی اندروید | ⚠️ از طریق `fcm.googleapis.com` — همان مشکل دسترسی FCM در ایران |
| Web Push روی iOS | ⚠️ فقط iOS 16.4+ و **فقط اگر به Home Screen اضافه شده باشد** |
| دقت زمان‌بندی | ⚠️ با cron مربوط به GitHub Actions حدود ۵ تا ۱۵ دقیقه |

این محدودیت پلتفرم است نه نقص پیاده‌سازی. صفحهٔ پروفایل آن را صریح به کاربر می‌گوید به‌جای اینکه کلیدی نشان دهد که بی‌صدا کار نمی‌کند.

اگر بعداً اعلان قطعی لازم شد، یک پوستهٔ نازک نیتیو (Capacitor یا TWA) روی همین PWA سوار می‌شود و `AlarmManager` واقعی می‌دهد — بدون بازنویسی.

---

## ۱۱ب. اپ نیتیو اندروید (کنار گذاشته شد)

```
mobile/app/src/main/java/.../
  core/          دیتا و دامنهٔ مشترک، DI، تاریخ، فارسی‌سازی
  data/          Retrofit + Room + repository
  domain/        مدل و usecase
  presentation/  صفحات Compose + ViewModel
  navigation/    مسیرها + deep link
  notifications/ زمان‌بندی آلارم + کانال‌ها
```

- Compose + Material 3 · RTL کامل · فونت وزیرمتن
- هیچ متن UI داخل کد — همه در `strings.xml`
- ارقام فارسی از formatter مشترک
- **Offline-first:** Room منبع حقیقت UI است؛ شبکه فقط آن را تازه می‌کند. این هم بند ۲۵ را برآورده می‌کند و هم cold start رندر را می‌پوشاند.
- flavorها: `bazaar` (بدون GMS) · `play` (با GMS)
- Push پشت `PushProvider` — پیاده‌سازی FCM فقط در flavor مربوط به play

---

## ۱۲. آماده‌سازی برای آینده

| قابلیت آینده | قلابی که همین حالا گذاشته می‌شود |
|---|---|
| جستجوی زبان طبیعی | `QueryParser` که ساختار فیلتر تولید می‌کند؛ MVP نسخهٔ کلیدواژه‌ای است |
| چندزبانه | جدول `exhibition_translations`، نه ستون ثابت |
| شهر و کشور دیگر | `countries` → `cities` → `venues` از روز اول |
| Monetization | `users.tier` + بررسی سقف در سرویس Reminder |
| رتبه‌بندی شخصی | `relevanceScore` به‌صورت تابع خالص، MVP ساده |

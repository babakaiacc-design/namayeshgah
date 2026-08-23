# Exhibition Reminder

اپلیکیشن هوشمند تقویم و یادآور نمایشگاه‌ها — کشف، دنبال‌کردن و یادآوری نمایشگاه‌ها.

شروع از تهران، با معماری آمادهٔ گسترش به شهرهای دیگر ایران و نمایشگاه‌های بین‌المللی.

---

## ساختار

```
backend/   NestJS + TypeORM + Postgres — API و خط لولهٔ داده
mobile/    اندروید (Kotlin + Jetpack Compose)
admin/     پنل ادمین (Next.js)
relay/     سرویس fetch داخل ایران (فاز بعد)
shared/    قراردادهای مشترک
docs/      مستندات معماری و منابع داده
```

## مستندات

| سند | محتوا |
|---|---|
| [PROJECT_PLAN.md](docs/PROJECT_PLAN.md) | فازبندی و Definition of Done |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | تصمیمات معماری و دلایلشان |
| [DATA_SOURCES.md](docs/DATA_SOURCES.md) | منابع داده، وضعیت دسترسی، قواعد fetch |

---

## پیش‌نیازها

| ابزار | نسخه |
|---|---|
| Node.js | ۲۰ یا بالاتر |
| Docker | برای Postgres محلی (اختیاری — می‌توان مستقیم به Supabase وصل شد) |
| JDK | ۲۱ (همراه Android Studio) |
| Android SDK | API 34 یا بالاتر |

---

## راه‌اندازی Backend

```bash
cd backend
npm install
cp .env.example .env
```

سپس `.env` را با مقادیر واقعی پر کنید (راهنما در [ENVIRONMENT.md](docs/ENVIRONMENT.md)).

**Postgres محلی:**

```bash
docker compose up -d
```

**اجرای migration و سرور:**

```bash
npm run migration:run
npm run start:dev
```

بررسی سلامت:

```bash
curl http://localhost:3000/health
```

---

## استقرار

| بخش | سرویس | یادداشت |
|---|---|---|
| دیتابیس | Supabase (Free) | حتماً از **Pooler پورت `6543`** استفاده شود |
| API | Render (Free) | بعد از ۱۵ دقیقه بی‌کاری می‌خوابد |
| زمان‌بند | GitHub Actions | Render رایگان cron ندارد |
| ادمین | Vercel (Free) | |

> **مهم:** Supabase Pooler در حالت transaction با prepared statement سازگار نیست.
> تنظیم `DB_PREPARE=false` الزامی است، وگرنه خطای «prepared statement already exists» می‌گیرید.

---

## قوانین مشارکت

1. **هیچ تاریخ نمایشگاهی حدس زده نشود** — نبود داده یعنی `UNKNOWN`، اختلاف یعنی `CONFLICT`
2. هر تاریخ باید به یک منبع قابل ردیابی باشد
3. `.env` هرگز commit نشود
4. Adapterها در برابر fixture ذخیره‌شده تست شوند، نه شبکهٔ زنده
5. متن UI فقط در `strings.xml` — هیچ رشتهٔ فارسی داخل کد
6. تبدیل تاریخ فقط با کتابخانه، هرگز دستی

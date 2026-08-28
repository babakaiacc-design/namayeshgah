# DEPLOYMENT.md

راهنمای انتشار: همه‌چیز (وب، بک‌اند، دیتابیس) روی یک سرور اختصاصی (`arastehgostar`)، پشت nginx، با دامنهٔ `fairalarm.ir`.

> این پروژه قبلاً روی Render + Vercel + Supabase مستقر بود. به این دلیل که سرور اصلی در
> ایران است و مسیر شبکه به هر سرویس ابری خارجی (از جمله Supabase) یک ناپایداری متناوب
> و غیرقابل‌پیش‌بینی دارد — در سطح بسته‌های شبکه تأیید شده: بعضی اتصالات بی‌صدا drop
> می‌شوند و دقیقاً همان تلاش در دفعهٔ بعد موفق است — همه‌چیز به همین سرور منتقل شد تا
> این مسیر بین‌المللی اصلاً درگیر نشود.

---

## معماری

```
                 nginx (fairalarm.ir, SSL واقعی)
                        │
        ┌───────────────┼────────────────┐
        │                                │
   /  (استاتیک)                    /api/v1/  و  /health
        │                                │
/var/www/exhibition-reminder     127.0.0.1:3001
   (خروجی build وب)                      │
                              کانتینر Docker: exhibition-reminder-api
                                           │
                              کانتینر Docker: exhibition-reminder-db
                                   (Postgres 17، self-hosted)
```

هیچ بخشی از این مسیر از مرز شبکهٔ ایران خارج نمی‌شود، به‌جز خود Sync (که عمداً به سایت‌های ایرانی مثل eventro.ir وصل می‌شود — همان چیزی که باید).

---

## دسترسی

```bash
ssh arastehgostar
```

مسیرها روی سرور:
- وب استاتیک: `/var/www/exhibition-reminder/`
- بک‌اند + دیتابیس (docker compose): `/opt/apps/exhibition-reminder-api/`
- `.env` (commit نمی‌شود، فقط روی سرور): `/opt/apps/exhibition-reminder-api/.env`
- nginx vhost: `/etc/nginx/sites-available/exhibition-reminder.conf`
- backupهای روزانهٔ دیتابیس: `/opt/apps/exhibition-reminder-api/backups/`

---

## استقرار اولیه (یک‌بار انجام شده، فقط برای مرجع)

1. **وب:** `cd web && npm ci && npm run build` سپس `dist/` را با `scp` به `/var/www/exhibition-reminder/` منتقل کنید (بدون نیاز به `VITE_API_URL` — فرانت به‌صورت پیش‌فرض به مسیر نسبی `/api/v1` وصل می‌شود).
2. **بک‌اند:** `backend/Dockerfile` (multi-stage) + `docker-compose.yml` روی سرور (نه در ریپو، چون شامل جزئیات زیرساخت است) دو سرویس تعریف می‌کند: `db` (Postgres 17) و `api` (NestJS).
3. **دیتابیس:** مهاجرت‌ها و seed خودکار هنگام بوت اپلیکیشن اجرا می‌شوند (`BootstrapService`) — نیازی به اجرای دستی نیست.
4. **nginx:** یک vhost با دو بخش — `location /` برای فایل‌های استاتیک، `location /api/v1/` و `/health` برای proxy به `127.0.0.1:3001`. مسیر `location = /api/v1/internal/sync` به‌طور جداگانه timeout بلندتری (۹۰۰ ثانیه) دارد چون Sync می‌تواند طول بکشد.
5. **SSL:** `certbot --nginx -d fairalarm.ir -d www.fairalarm.ir` بعد از این‌که DNS واقعاً propagate شد.

---

## به‌روزرسانی بعد از تغییر کد

هیچ CI/CD خودکاری وصل نیست (بر خلاف Render/Vercel قبلی) — انتشار دستی است:

### وب

```bash
cd web && npm ci && npm run build
scp -r dist/* arastehgostar:/var/www/exhibition-reminder/
```

### بک‌اند

```bash
# کد جدید را روی سرور بگذارید (rsync/scp به backend/)، سپس:
ssh arastehgostar "cd /opt/apps/exhibition-reminder-api && docker compose build && docker compose up -d"
```

> **نکتهٔ مهم:** `docker compose build` گاهی به‌خاطر ناپایداری شبکهٔ ایران به Docker Hub
> در تلاش اول شکست می‌خورد (معمولاً روی احراز هویت token یا یک لایهٔ حجیم). این را با
> **دوباره اجرا کردن همان دستور** رفع کنید — معمولاً در تلاش دوم یا سوم موفق می‌شود.
> یک bridge محلی (`docker-tls-bridge`, سرویس systemd مبتنی بر mitmproxy روی پورت
> ۸۰۸۰) از قبل برای دور زدن یک مسدودی خاص TLS تنظیم شده؛ دست نزنید مگر لازم شود.

---

## دیتابیس: Postgres Self-Hosted

- Image: `postgres:17-alpine` (باید با نسخهٔ واقعی همخوان نگه داشته شود اگر عوض شد)
- رمز عبور در `.env` روی سرور، کلید `POSTGRES_PASSWORD`
- اتصال از داخل بک‌اند: `postgresql://postgres:<پسورد>@db:5432/exhibition_reminder` (نام سرویس `db` در شبکهٔ داخلی Docker Compose)
- `DB_SSL=false`, `DB_PREPARE=true` (بدون Pooler، تلهٔ Supabase دیگر وجود ندارد)

### Backup

اسکریپت `/opt/apps/exhibition-reminder-api/backup.sh` هر شب ساعت ۰۲:۱۷ (cron) یک `pg_dump` می‌گیرد و در `backups/` ذخیره می‌کند؛ فایل‌های قدیمی‌تر از ۱۴ روز پاک می‌شوند. برای بازیابی:

```bash
docker exec -i exhibition-reminder-db psql -U postgres -d exhibition_reminder < backups/exhibition_reminder_YYYY-MM-DD.dump
```

(یا با `pg_restore -F c` اگر فرمت custom باشد.)

---

## GitHub Actions — همگام‌سازی زمان‌بندی‌شده

`.github/workflows/sync.yml` هر ۱۲ ساعت `POST /api/v1/internal/sync` می‌زند و روی خطای گذرا (مثلاً یک اتصال دیتابیس ناموفق تصادفی) تا ۳ بار retry می‌کند.

**Settings → Secrets and variables → Actions:**

| نام Secret | مقدار |
|---|---|
| `API_BASE_URL` | `https://fairalarm.ir` (یا موقتاً `https://exhibition-reminder.171-22-26-103.sslip.io` تا دامنه فعال شود) |
| `SYNC_SECRET` | همان مقدار `SYNC_SECRET` در `.env` روی سرور |

برای تست فوری: **Actions → Scheduled sync → Run workflow**.

---

## بررسی نهایی

- [ ] `curl https://fairalarm.ir/health` → `{"status":"ok","database":"up"}`
- [ ] باز کردن `https://fairalarm.ir` در مرورگر → لیست نمایشگاه‌ها لود می‌شود
- [ ] `curl https://fairalarm.ir/api/v1/exhibitions/today?city=tehran` → داده واقعی
- [ ] `Actions → Scheduled sync` یک بار دستی اجرا و سبز شود
- [ ] در آیفون: صفحه را در Safari باز کنید → Share → Add to Home Screen

---

## DNS (وقتی دامنه تأیید شد)

در پنل دامنهٔ `fairalarm.ir`:

```
A    @      171.22.26.103
A    www    171.22.26.103
```

بعد از propagate شدن (`dig fairalarm.ir` یا `nslookup`):

```bash
ssh arastehgostar "certbot --nginx --register-unsafely-without-email -d fairalarm.ir -d www.fairalarm.ir"
```

و `server_name` در nginx vhost از قبل هر دو دامنه را دارد — نیازی به ویرایش دستی نیست.

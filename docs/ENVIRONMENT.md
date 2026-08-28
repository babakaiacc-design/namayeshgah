# ENVIRONMENT.md

راهنمای متغیرهای محیطی. الگو در [`backend/.env.example`](../backend/.env.example) است.

> `.env` هرگز commit نمی‌شود. فقط `.env.example` در مخزن است.

---

## اپلیکیشن

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `NODE_ENV` | `development` | در `production` اعتبارسنجی سخت‌گیرانه فعال می‌شود |
| `PORT` | `3000` | Render خودش این را ست می‌کند |
| `API_PREFIX` | `api/v1` | `/health` عمداً بیرون از این prefix است |
| `LOG_LEVEL` | `info` | در توسعه `debug` |
| `CORS_ORIGINS` | `*` (باز) | فقط در `production` خوانده می‌شود. مبدأهای مجاز، با کاما جدا، مثلاً `https://exhibition-reminder.vercel.app`. تا وقتی فرانت دیپلوی نشده خالی بماند |

---

## دیتابیس

| متغیر | توضیح |
|---|---|
| `DATABASE_URL` | رشتهٔ اتصال Postgres |
| `DB_SSL` | برای Supabase حتماً `true` |
| `DB_PREPARE` | **برای Pooler حتماً `false`** — پایین را بخوانید |
| `DB_POOL_SIZE` | محلی ۱۰، روی Render رایگان ۵ |
| `DB_SYNCHRONIZE` | همیشه `false`. اسکیما فقط با migration |

### تلهٔ Pooler سوپابیس

Supabase دو آدرس اتصال می‌دهد:

```
مستقیم:  db.<ref>.supabase.co:5432
Pooler:  aws-0-<region>.pooler.supabase.com:6543   ← این را استفاده کنید
```

**چرا Pooler:** پلن رایگان تعداد اتصال مستقیم بسیار کمی دارد و Render آن را تمام می‌کند.

**چرا `DB_PREPARE=false`:** Pooler در حالت transaction بین دستورها اتصال را عوض می‌کند، پس prepared statement باقی نمی‌ماند. اگر این را `true` بگذارید خطای گیج‌کنندهٔ زیر را می‌گیرید:

```
error: prepared statement "S_1" already exists
```

این خطا هیچ ربطی به کد شما ندارد و ساعت‌ها وقت تلف می‌کند. به همین دلیل `validateEnv` هنگام بوت در production این حالت را تشخیص می‌دهد و **اجازهٔ بالا آمدن نمی‌دهد** — تست‌هایش در [`env.validation.spec.ts`](../backend/src/config/env.validation.spec.ts) هستند.

---

## Auth

| متغیر | توضیح |
|---|---|
| `JWT_SECRET` | حداقل ۳۲ کاراکتر در production |
| `JWT_EXPIRES_IN` | پیش‌فرض `90d` — کاربر ناشناس نباید مدام خارج شود |

```bash
openssl rand -base64 48
```

---

## Sync

| متغیر | توضیح |
|---|---|
| `SYNC_SECRET` | هدر `X-Sync-Secret` برای `POST /internal/sync` |
| `FETCH_USER_AGENT` | User-Agent شناسا با آدرس تماس (بند ۴۷) |
| `FETCH_TIMEOUT_MS` | پیش‌فرض ۶۰۰۰۰ |
| `FETCH_RATE_LIMIT_PER_SEC` | پیش‌فرض ۱ — بالاتر نبرید |
| `FETCH_MAX_RETRIES` | با backoff نمایی |

```bash
openssl rand -hex 32
```

`SYNC_SECRET` باید **در هر سه جا یکی باشد**: `.env` محلی، متغیر محیطی Render، و repository secret در GitHub.

---

## Relay (فاز بعد)

| متغیر | توضیح |
|---|---|
| `RELAY_ENABLED` | فعلاً `false` |
| `RELAY_URL` | آدرس Relay داخل ایران |
| `RELAY_HMAC_SECRET` | امضای پیام‌های Relay |

تا وقتی `false` است، Adapterهای منابع مسدود اجرا نمی‌شوند.

---

## Secretهای GitHub Actions

در `Settings → Secrets and variables → Actions`:

| Secret | مقدار |
|---|---|
| `API_BASE_URL` | `https://fairalarm.ir` |
| `SYNC_SECRET` | دقیقاً همان مقدار در `.env` روی سرور اختصاصی |

---

## چک‌لیست استقرار

جزئیات کامل در [DEPLOYMENT.md](DEPLOYMENT.md). خلاصه:

- [ ] Postgres self-hosted روی سرور بالاست (`docker compose up -d db`)
- [ ] `DB_PREPARE=true` و `DB_SSL=false` (بدون Pooler، این محدودیت وجود ندارد)
- [ ] `API_BASE_URL` و `SYNC_SECRET` در GitHub secrets به‌روزند
- [ ] `/health` جواب `{"status":"ok","database":"up"}` می‌دهد
- [ ] اجرای دستی workflow با `workflow_dispatch` موفق است

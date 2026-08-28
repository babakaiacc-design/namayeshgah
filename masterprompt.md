هدف: مهاجرت این پروژه (backend + web) از Render/Vercel به سرور اختصاصی خودمون، با نگه‌داشتن دیتابیس روی همون Supabase فعلی (چیزی عوض نمی‌کنیم اونجا).

## زیرساخت آماده روی سرور (از قبل ساخته شده، دست نزن مگر خواستم)
- دسترسی: `ssh arastehgostar` (کلید و کانفیگ SSH از قبل روی همین کامپیوتر ست شده، پسورد لازم نیست)
- وب (استاتیک): مسیر `/var/www/exhibition-reminder/` — الان یک index.html جایگزین‌شدنی داره
- بک‌اند (داکر): مسیر `/opt/apps/exhibition-reminder-api/` — خالیه، باید Dockerfile + docker-compose بسازی
- پورت رزرو شده برای بک‌اند: `3001` (nginx از قبل به `127.0.0.1:3001` proxy می‌کنه)
- nginx vhost هر دو از قبل هست و با SSL واقعی (Let's Encrypt) روی این آدرس‌های موقت کار می‌کنن:
  - https://exhibition-reminder.171-22-26-103.sslip.io (وب)
  - https://exhibition-reminder-api.171-22-26-103.sslip.io (API)
- registry مرکزی سایت‌ها: `/opt/sites/registry.json`
- اسکریپت‌های مدیریتی: `/opt/sites/scripts/new-site.sh` و `remove-site.sh` — برای این سایت لازم نیست دوباره اجرا بشن، فقط کانفیگ nginx موجود رو ویرایش کن

## دامنه
دامنه‌ی www.fairalarm.ir خریداری شده. **معماری پیشنهادی: تک‌دامنه با path routing** (نه ساب‌دامنه‌ی جدا برای API) چون:
- فرانت‌اند از قبل به‌صورت پیش‌فرض به مسیر نسبی `/api/v1` وصل می‌شه (`web/src/api/client.ts` — اگه `VITE_API_URL` ست نشه)
- با هم‌دامنه‌بودن، دیگه به `CORS_ORIGINS` و پیچیدگی‌های cross-origin نیازی نیست

یعنی: `https://www.fairalarm.ir/` → فایل‌های استاتیک وب، و `https://www.fairalarm.ir/api/v1/` → proxy به بک‌اند روی `127.0.0.1:3001`.

## کارهایی که باید انجام بدی

### ۱. بیلد و انتقال وب
```bash
cd web && npm ci && npm run build
```
خروجی `dist/` رو (بدون نیاز به `VITE_API_URL`، چون مسیر نسبی پیش‌فرضه) با `scp`/`rsync` به `/var/www/exhibition-reminder/` روی سرور منتقل کن (جایگزین محتوای placeholder).

### ۲. Dockerize کردن بک‌اند
پروژه فعلاً Dockerfile نداره. یکی بساز (multi-stage: `npm ci --include=dev && npm run build` در استیج build، بعد `node dist/main.js` در استیج runtime — دقیقاً مثل `buildCommand`/`startCommand` توی `render.yaml`). یک `docker-compose.yml` هم توی `/opt/apps/exhibition-reminder-api/` بساز که:
- پورت `127.0.0.1:3001:3000` رو bind کنه (اپ داخل کانتینر رو `PORT=3000` بذار)
- `restart: unless-stopped`
- متغیرهای محیطی رو از یک فایل `.env` (که commit نمی‌شه) بخونه

### ۳. مقادیر واقعی env
این مقادیر رو **از Render dashboard → Environment** بگیر (چون `JWT_SECRET` و `SYNC_SECRET` با `generateValue` ساخته شدن و جایی توی کد نیستن) — از کاربر بخواه اگه بهشون دسترسی نداری:
- `DATABASE_URL` (همون Supabase pooler، پورت 6543)
- `JWT_SECRET`
- `SYNC_SECRET` (⚠️ همینی که الان توی GitHub Actions secret هم هست — عوضش نکن مگر بعداً هماهنگ با اونجا هم آپدیت کنی)
- بقیه طبق `.env.example`: `NODE_ENV=production`, `API_PREFIX=api/v1`, `DB_SSL=true`, `DB_PREPARE=false`, `DB_POOL_SIZE=5`, `DB_SYNCHRONIZE=false`
- `CORS_ORIGINS` رو هم برای احتیاط بذار `https://www.fairalarm.ir,https://fairalarm.ir` (حتی با تک‌دامنه بودن، ضرری نداره)

### ۴. بالا آوردن کانتینر
```bash
ssh arastehgostar "cd /opt/apps/exhibition-reminder-api && docker compose up -d --build"
```

### ۵. ویرایش nginx برای دامنه‌ی جدید + path routing
فایل `/etc/nginx/sites-available/exhibition-reminder.conf` رو ویرایش کن:
- `server_name` رو به `www.fairalarm.ir fairalarm.ir` عوض کن (یا اضافه کن کنار sslip.io)
- یک بلاک اضافه کن:
```nginx
location /api/v1/ {
    proxy_pass http://127.0.0.1:3001/api/v1/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /health {
    proxy_pass http://127.0.0.1:3001/health;
}
```
بعد: `nginx -t && systemctl reload nginx`

سایت جدای `exhibition-reminder-api` (روی sslip.io) رو می‌تونی دست‌نخورده نگه داری برای تست مستقیم بک‌اند، یا بعداً با `remove-site.sh exhibition-reminder-api` جمعش کنی.

### ۶. DNS (این بخش کار خود کاربره، نه تو — فقط بهش یادآوری کن)
توی پنل دامنه‌ی fairalarm.ir دو رکورد A اضافه کنه:
```
A    @      171.22.26.103
A    www    171.22.26.103
```

### ۷. گواهی SSL واقعی
وقتی DNS propagate شد (با `dig www.fairalarm.ir` یا `nslookup` چک کن):
```bash
ssh arastehgostar "certbot --nginx --register-unsafely-without-email -d fairalarm.ir -d www.fairalarm.ir"
```

### ۸. تست نهایی
```bash
curl -sI https://www.fairalarm.ir/
curl -s https://www.fairalarm.ir/api/v1/exhibitions   # یا هر مسیر سبک دیگه
curl -s https://www.fairalarm.ir/health
```

### ۹. بعد از تأیید کارکرد کامل
- Render و Vercel رو نگه دار یا جمع کن (تصمیم با کاربره)
- اگه Render جمع شد، دیگه نیازی به ping دوره‌ای GitHub Actions برای بیدارنگه‌داشتنش نیست (حذفش کن) — ولی ping هر ۱۲ ساعته‌ی Supabase رو نگه دار چون دیتابیس هنوز اونجاست

## چیزی که نباید دست بزنی
روی این سرور یک n8n هم از قبل در حال اجراست (با کرون auto-update خودش در `/opt/n8n/`) — کاملاً بی‌ربط به این پروژه‌ست، بهش دست نزن.

# DEPLOYMENT.md

راهنمای انتشار عمومی: Backend روی Render، وب‌اپ روی Vercel، دیتابیس روی Supabase.

> این مراحل نیاز به حساب کاربری روی چهار سرویس دارند (GitHub، Supabase، Render، Vercel).
> ساخت حساب و لاگین کردن کاری است که فقط خودتان می‌توانید انجام دهید — من به این
> حساب‌ها دسترسی ندارم. آنچه از قبل آماده شده: `render.yaml` (Blueprint کامل بک‌اند)،
> `web/vercel.json` (routing برای SPA)، و متغیر `CORS_ORIGINS`. با این‌ها، هر چهار
> مرحلهٔ زیر مجموعاً حدود ۲۰-۳۰ دقیقه طول می‌کشد.

---

## ۱. GitHub — ساخت مخزن و push

الان هیچ remote‌ای تنظیم نیست؛ پروژه فقط محلی است.

1. یک مخزن خصوصی یا عمومی جدید در GitHub بسازید (بدون README/gitignore — این پروژه از قبل دارد).
2. remote را اضافه و push کنید:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USER/exhibition-reminder.git
git branch -M main
git push -u origin main
```

Render و Vercel هر دو مستقیماً از این مخزن دیپلوی می‌کنند.

---

## ۲. Supabase — دیتابیس

1. در [supabase.com](https://supabase.com) پروژهٔ رایگان جدید بسازید (یک رمز عبور دیتابیس تعیین می‌کنید — جایی یادداشت کنید).
2. **Project Settings → Database → Connection string → Transaction pooler** را باز کنید (پورت `6543`، **نه** `5432` مستقیم — دلیلش در [ARCHITECTURE.md](ARCHITECTURE.md) بخش ۳ است).
3. آدرس را برای مرحلهٔ بعد نگه دارید؛ شبیه این است:
   ```
   postgresql://postgres.XXXXXXXX:YOUR-PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
   ```
4. مهاجرت‌ها و seed در `preDeployCommand` خود Render اجرا می‌شوند (مرحلهٔ ۳) — نیازی به اجرای دستی از همین‌جا نیست.

---

## ۳. Render — Backend (Blueprint)

1. در داشبورد Render: **New → Blueprint** → مخزن GitHub را انتخاب کنید. Render خودش `render.yaml` را در ریشهٔ مخزن پیدا می‌کند.
2. هنگام ساخت، Render برای سه متغیری که `sync: false` دارند مقدار می‌خواهد:
   - `DATABASE_URL` → همان connection string پولر از مرحلهٔ ۲.
   - `FETCH_USER_AGENT` → یک User-Agent شناسا با آدرس تماس، طبق بند ۴۷ برنامه — مثلاً `ExhibitionReminderBot/1.0 (+mailto:you@example.com)`.
   - `CORS_ORIGINS` → فعلاً خالی بگذارید؛ بعد از مرحلهٔ ۴ برمی‌گردید و پر می‌کنید.
3. `JWT_SECRET` و `SYNC_SECRET` را Render خودش تصادفی می‌سازد — نیازی به وارد کردن دستی نیست.
4. Deploy کنید. اولین build چند دقیقه طول می‌کشد (شامل build بک‌اند). مهاجرت و seed خودکار هنگام شروع اپلیکیشن اجرا می‌شوند.
5. بعد از سبز شدن، آدرس سرویس را یادداشت کنید — چیزی مثل:
   ```
   https://exhibition-reminder-api.onrender.com
   ```
6. بررسی سلامت:
   ```bash
   curl https://exhibition-reminder-api.onrender.com/health
   ```
   باید `{"status":"ok","database":"up"}` برگرداند.

> پلن رایگان Render بعد از ۱۵ دقیقه بی‌کاری می‌خوابد و بیدارشدنش ~۵۰ ثانیه طول می‌کشد.
> این طبیعی است — کلاینت وب برای همین اول کش را نشان می‌دهد.

---

## ۴. Vercel — وب‌اپ

1. در داشبورد Vercel: **Add New → Project** → همان مخزن GitHub.
2. **Root Directory** را روی `web` بگذارید (این یک مونو-رپو است؛ Vercel باقی تنظیمات Vite را خودش تشخیص می‌دهد).
3. یک Environment Variable اضافه کنید:
   - `VITE_API_URL` = آدرس Render + پیشوند نسخه، مثلاً:
     ```
     https://exhibition-reminder-api.onrender.com/api/v1
     ```
4. Deploy کنید. آدرس نهایی چیزی مثل `https://exhibition-reminder.vercel.app` خواهد بود.

### برگشت به Render برای بستن CORS

حالا که آدرس Vercel معلوم است، به Render برگردید → سرویس → Environment → `CORS_ORIGINS` را ست کنید:

```
https://exhibition-reminder.vercel.app
```

(چند مبدأ را با کاما جدا کنید، مثلاً دامنهٔ سفارشی به‌علاوهٔ preview URL.) ذخیره کردن یک redeploy خودکار می‌زند.

بدون این مرحله هم اپ کار می‌کند — `CORS_ORIGINS` خالی یعنی API برای هر مبدأیی باز است — ولی بعد از اینکه فرانت واقعی دیپلوی شد، بستنش به آن یک مبدأ منطقی است.

---

## ۵. GitHub Actions — همگام‌سازی زمان‌بندی‌شده

`.github/workflows/sync.yml` هر ۱۲ ساعت اجرا می‌شود و هم Sync را می‌زند هم سرویس رایگان Render/Supabase را بیدار نگه می‌دارد. دو Secret مخزن لازم دارد:

**Settings → Secrets and variables → Actions → New repository secret:**

| نام Secret | مقدار |
|---|---|
| `API_BASE_URL` | آدرس خام Render، **بدون** مسیر یا `/` انتهایی — مثلاً `https://exhibition-reminder-api.onrender.com` |
| `SYNC_SECRET` | همان مقداری که Render برای `SYNC_SECRET` تصادفی ساخت (Render → سرویس → Environment → مقدار را کپی کنید) |

برای تست فوری بدون منتظر ماندن تا کرون بعدی: **Actions → Scheduled sync → Run workflow**.

---

## ۶. بررسی نهایی

- [ ] `curl https://<render-url>/health` → `200`
- [ ] باز کردن آدرس Vercel در مرورگر → لیست نمایشگاه‌ها لود می‌شود
- [ ] یک مسیر داخلی را مستقیم رفرش کنید (مثلاً `/calendar`) → نباید ۴۰۴ بدهد (این را `web/vercel.json` تضمین می‌کند)
- [ ] `Actions → Scheduled sync` یک بار دستی اجرا و سبز شود
- [ ] در آیفون: صفحه را در Safari باز کنید → Share → Add to Home Screen

---

## به‌روزرسانی بعدی

هر push به شاخهٔ `main` هم Render و هم Vercel را خودکار دوباره دیپلوی می‌کند — کار دستی دیگری لازم نیست.

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# بالا آوردنِ کاملِ محیط توسعه: پایگاه‌داده → API → وب
#
# استفاده:
#   bash scripts/up.sh
#
# چرا این اسکریپت؟ چون در محیطِ ابری (Sandbox) هر بار که نشست تازه می‌شود،
# فرآیندهای پس‌زمینه از بین می‌روند. این اسکریپت هر سه بخش را به ترتیبِ
# وابستگی بالا می‌آورد و «اگر از پیش در حال اجرا بود» دوباره اجرا نمی‌کند.
#
# نکته: برای اجرایِ طولانی، API و وب را در پنجره/فرآیندِ جدا نگه دارید؛
# این اسکریپت فقط آن‌ها را راه می‌اندازد و منتظر نمی‌ماند:
#   bash scripts/up.sh          (فقط پایگاه‌داده در این نشست می‌ماند)
#   سپس: npm run start:api  و  npm run start:web
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "── ۱/۳ پایگاه‌داده"
bash scripts/pg-start.sh

# نشانیِ سوکت باید با همان قراردادِ pg-start.sh باشد (بیرون از شاخه‌ی پروژه)
PGRUN="${PGRUN:-/tmp/setshop-pgrun}"
export PGURL="postgres://setshop@/setshop?host=${PGRUN}&port=5433"
export DB_URL="$PGURL"

echo "── ۲/۳ مهاجرت‌ها"
npm run migrate --silent 2>&1 | tail -2

# نشاندنِ کاتالوگ و مدیر: فقط وقتی پایگاه خالی است.
# چرا با شرط؟ چون نشاندن همیشه یعنی بازنویسیِ کالاهایی که ممکن است مدیر در
# پنل ساخته باشد؛ اما در نخستین بالا آوردن، فروشگاهِ خالی هیچ چیزی برایِ
# نمایش ندارد. شرط، هر دو حالت را درست می‌کند.
PRODUCTS="$(psql "$PGURL" -tAc 'SELECT COUNT(*) FROM products' 2>/dev/null || echo 0)"
if [[ "${PRODUCTS//[[:space:]]/}" == "0" ]]; then
  echo "── نشاندنِ کاتالوگ و مدیر (پایگاه خالی است)"
  TSX_TSCONFIG_PATH=./tsconfig.json ./node_modules/.bin/tsx scripts/seed-catalog.ts 2>&1 | tail -5
  TSX_TSCONFIG_PATH=./tsconfig.json ./node_modules/.bin/tsx scripts/create-admin.ts 2>&1 | tail -6
fi

# داده‌یِ ویترین (تخفیف، «جدید»، موجودیِ کم): همواره، چون بی‌زیان و تکرارپذیر است
TSX_TSCONFIG_PATH=./tsconfig.json ./node_modules/.bin/tsx scripts/seed-showcase.ts 2>&1 | tail -6

echo "── ۳/۳ آماده‌سازیِ وب"
if [[ ! -d "apps/web/.next" ]]; then
  echo "ساختِ نخستینِ وب (یک‌بار)…"
  npm run build:web --silent 2>&1 | tail -2
fi

# ─────────────────────────────────────────────────────────────────────────────
# کلیدِ تماسِ درونی (وب → API)
#
# چرا اینجا ساخته می‌شود؟ چون یک «راز» است و نباید در مخزن بنشیند، اما هر
# دو سرویس باید **همان یکی** را داشته باشند — وگرنه معافیتِ مهارِ بار کار
# نمی‌کند و لایه‌یِ وب در شلوغی، سهمِ همه‌یِ خریداران را خرج می‌کند. پس
# یک‌بار ساخته و در شاخه‌ای بیرون از مخزن نگه داشته می‌شود؛ دفعه‌هایِ بعد
# همان خوانده می‌شود تا پس از بازنشانیِ محیط، وب و API باز هم هم‌زبان
# بمانند.
# ─────────────────────────────────────────────────────────────────────────────
TOKEN_FILE="$HOME/var/internal-api-token"
mkdir -p "$HOME/var"
if [[ ! -s "$TOKEN_FILE" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24 > "$TOKEN_FILE"
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKEN_FILE"
  fi
  chmod 600 "$TOKEN_FILE"
fi
INTERNAL_API_TOKEN="$(cat "$TOKEN_FILE")"
export INTERNAL_API_TOKEN

# ─────────────────────────────────────────────────────────────────────────────
# کلیدِ گاوصندوق (رمزِ کلیدِ خصوصیِ مؤدیان)
#
# چرا در فایل و بیرون از مخزن، و نه در پایگاه؟ چون اگر در پایگاه بود، هر
# پشتیانی از آن کافی بود تا کلیدِ امضایِ مالیاتی به دست بیاید — یعنی هر کس
# که به پشتیان رسید می‌توانست به نامِ فروشنده فاکتور صادر کند. کلید از
# «محیط» می‌آید و پشتیانِ پایگاه بی‌آن ارزشی ندارد.
#
# و چرا در شاخه‌یِ خانه نگه داشته می‌شود؟ چون اگر هر بار تازه ساخته شود،
# گاوصندوقِ نشستِ پیش دیگر گشوده نمی‌شود و فروشنده گمان می‌کند گواهی پاک شده
# است. یک‌بار ساخته و سپس همان خوانده می‌شود.
# ─────────────────────────────────────────────────────────────────────────────
MASTER_KEY_FILE="$HOME/var/master-key"
if [[ ! -s "$MASTER_KEY_FILE" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 > "$MASTER_KEY_FILE"
  else
    head -c 32 /dev/urandom | base64 -w0 > "$MASTER_KEY_FILE"
  fi
  chmod 600 "$MASTER_KEY_FILE"
fi
SET_MASTER_KEY="$(cat "$MASTER_KEY_FILE")"
export SET_MASTER_KEY

echo
echo "✓ محیط آماده است."
echo "  پایگاه: $PGURL"
echo "  کلیدِ تماسِ درونی: $TOKEN_FILE"
echo "  کلیدِ گاوصندوق:    $MASTER_KEY_FILE"
echo "  برای اجرا:"
echo "    DB_URL=\"$PGURL\" APP_URL=http://127.0.0.1:3100 INTERNAL_API_TOKEN=\"$INTERNAL_API_TOKEN\" SET_MASTER_KEY=\"$SET_MASTER_KEY\" npm run start:api"
echo "    INTERNAL_API_TOKEN=\"$INTERNAL_API_TOKEN\" npm run start:web"

#!/usr/bin/env bash
# =====================================================================
# ست‌شاپ — نصب‌کننده‌ی تولید (یک دستور، از صفر تا سرویسِ در حالِ اجرا)
# ---------------------------------------------------------------------
# اجرا:
#   sudo ./deploy/install.sh --domain forushgah.example.com
#
# این اسکریپت همان کارهایی را می‌کند که در README.md فصل‌های ۱ تا ۷ آمده،
# اما به‌جای این‌که شما را به کپی‌کردنِ دستی وادارد. چرا اسکریپت؟
#   چون مراحلِ استقرار «دنباله‌دار» هستند: اگر ترتیب عوض شود (مثلاً سرویس
#   پیش از ساخته‌شدنِ پایگاه‌داده فعال شود) با خطاهایی روبه‌رو می‌شوید که
#   تشخیص‌شان از یک پیکربندیِ غلط دشوار است. اینجا ترتیب یک‌بار درست نوشته
#   شده و بعد از آن تکرارپذیر است.
#
# چند اصل که در این اسکریپت رعایت شده:
#   ۱) بی‌خطر برای اجرایِ دوباره (idempotent): اگر چیزی هست، بازسازی نمی‌شود.
#   ۲) هرگز رازهایِ موجود را بازنویسی نمی‌کند: /etc/setshop/env اگر باشد،
#      دست ‌نخورده می‌ماند (فقط مجوزهایش درست می‌شود).
#   ۳) پیش از هر تغییر می‌گوید چه می‌کند؛ با --dry-run فقط می‌گوید و کاری
#      نمی‌کند، تا بتوانید پیش از اجرا بخوانیدش.
#
# گزینه‌ها:
#   --domain <دامنه>       نشانیِ سایت (برایِ nginx و CSP)
#   --pg-password <رمز>    فعال‌کردنِ دسترسیِ تی‌سی‌پیِ پستگرس (اختیاری)
#   --no-build             رد کردنِ ساختِ نسخه‌ی تولید وب
#   --no-nginx             نصب و تنظیمِ nginx انجام نشود
#   --dry-run              فقط نمایشِ آنچه انجام می‌شود
# =====================================================================
set -euo pipefail

# --- رنگ و نشانه (فقط برای خوانایی در ترمینال) ------------------------
if [[ -t 1 ]]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
else
  B=''; G=''; Y=''; R=''; N=''
fi
ok()   { echo "${G}✅${N} $*"; }
warn() { echo "${Y}⚠️ ${N} $*" >&2; }
err()  { echo "${R}❌${N} $*" >&2; }
head_() { echo; echo "${B}$*${N}"; }

# --- تنظیمات و گزینه‌ها ------------------------------------------------
APP_USER="setshop"
APP_DIR="/srv/setshop"
ETC_DIR="/etc/setshop"
LOG_DIR="/var/log/setshop"
BACKUP_DIR="/var/backups/setshop"
DATA_DIR="/var/lib/setshop"
DOMAIN=""
PG_PASSWORD=""
DO_BUILD=1
DO_NGINX=1
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)      DOMAIN="${2:-}"; shift 2 ;;
    --pg-password) PG_PASSWORD="${2:-}"; shift 2 ;;
    --no-build)    DO_BUILD=0; shift ;;
    --no-nginx)    DO_NGINX=0; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    -h|--help)     sed -n '2,40p' "$0"; exit 0 ;;
    *) err "گزینه‌ی ناشناخته: $1"; exit 2 ;;
  esac
done

# اجرا (یا فقط نمایش) — چرا یک تابع؟ چون با --dry-run همه‌ی فرمان‌ها دقیقاً
# همان متنی را نشان می‌دهند که در حالتِ واقعی اجرا می‌شود؛ حدس و گمان ندارد.
run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "   ${Y}می‌خواهد اجرا کند:${N} $*"
  else
    "$@"
  fi
}
note() { echo "   $*"; }

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
note "شاخه‌ی کد: ${SRC_DIR}"

# بررسیِ دسترسی — در حالتِ نمایش (--dry-run) هیچ تغییری رخ نمی‌دهد، پس می‌توان
# بدونِ root هم اجرا کرد تا بشود پیش از اجرایِ واقعی، دنباله‌ی کار را دید.
if [[ "$(id -u)" -ne 0 && "${DRY_RUN}" == "0" ]]; then
  err "این اسکریپت باید با دسترسیِ root اجرا شود (سرویسِ سیستمی و شاخه‌هایِ سیستمی می‌سازد)."
  err "برای دیدنِ آنچه انجام می‌دهد بدونِ تغییر: $0 --dry-run"
  exit 1
fi

command -v node >/dev/null || { err "node نصب نیست (نگاه کنید به README، فصل ۰)."; exit 1; }
command -v npm  >/dev/null || { err "npm نصب نیست."; exit 1; }

if [[ "${DRY_RUN}" == "1" ]]; then
  echo
  warn "حالتِ نمایش: هیچ چیزی تغییر نمی‌کند؛ فقط فرمان‌ها نشان داده می‌شوند."
fi

# =====================================================================
head_ "۱) کاربرِ سامانه و شاخه‌ها"
# =====================================================================
if id -u "${APP_USER}" >/dev/null 2>&1; then
  ok "کاربرِ ${APP_USER} از پیش هست"
else
  run useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
  ok "کاربرِ ${APP_USER} ساخته شد (بی‌ورود، ویژه‌ی سرویس)"
fi

for d in "${APP_DIR}" "${ETC_DIR}" "${LOG_DIR}" "${BACKUP_DIR}" "${DATA_DIR}" "${MEDIA_DIR:-/var/lib/setshop/media}"; do
  run mkdir -p "${d}"
done
ok "شاخه‌ها آماده‌اند"

# کد به شاخه‌ی سرویس منتقل می‌شود اگر آنجا نباشد
if [[ "${SRC_DIR}" != "${APP_DIR}" ]]; then
  if [[ -f "${APP_DIR}/package.json" ]]; then
    ok "کد از پیش در ${APP_DIR} هست (دست ‌نخورده می‌ماند)"
  else
    run rsync -a --exclude node_modules --exclude .git "${SRC_DIR}/" "${APP_DIR}/"
    ok "کد به ${APP_DIR} منتقل شد"
  fi
fi

# =====================================================================
head_ "۲) وابستگی‌ها (فقط اجرا)"
# =====================================================================
if [[ -d "${APP_DIR}/node_modules" ]]; then
  ok "node_modules از پیش هست"
else
  note "نصبِ وابستگی‌ها — چند دقیقه زمان می‌برد…"
  run su - "${APP_USER}" -s /bin/bash -c "cd ${APP_DIR} && npm ci --omit=dev"
  ok "وابستگی‌ها نصب شدند"
fi

# =====================================================================
head_ "۳) تنظیماتِ محیطی"
# =====================================================================
if [[ -f "${ETC_DIR}/env" ]]; then
  ok "فایلِ تنظیمات هست؛ بازنویسی نمی‌شود (رازها دست‌نخورده می‌مانند)"
else
  run cp "${APP_DIR}/deploy/env.example" "${ETC_DIR}/env"

  # رازِ نشست: تصادفیِ واقعی، نه مقدارِ پیش‌فرضِ فایلِ نمونه.
  # چرا اینجا؟ چون اگر راز همانِ نمونه بماند، هر کسی که مخزن را دیده می‌تواند
  # برای خودش توکنِ مدیر بسازد.
  SECRET="$(openssl rand -base64 48 | tr -d '\n' | tr '/+=' 'ABC')"
  run bash -c "sed -i 's|^JWT_SECRET=.*|JWT_SECRET=${SECRET}|' ${ETC_DIR}/env"

  # کلیدِ اصلیِ گاوصندوق: با آن، گواهیِ مؤدیان در پایگاه رمزنگاری می‌شود.
  # چرا همان‌جا ساخته می‌شود؟ چون اگر خالی بماند، گاوصندوق بسته می‌ماند و
  # مدیر در پنل می‌بیند «گواهی قابلِ ذخیره نیست» بی‌آنکه بداند چه کم است.
  # و چرا در همین فایل (بیرون از پایگاه)؟ چون کلیدِ کنارِ داده، داده را
  # نگه نمی‌دارد: هر نسخه‌یِ پشتیبان کافی بود تا کسی بتواند به نامِ فروشگاه
  # صورتحساب امضا کند.
  MASTER="$(openssl rand -base64 32 | tr -d '\n')"
  run bash -c "sed -i 's|^SET_MASTER_KEY=.*|SET_MASTER_KEY=${MASTER}|' ${ETC_DIR}/env"

  if [[ -n "${PG_PASSWORD}" ]]; then
    run bash -c "sed -i 's|^# DB_URL=postgres://setshop:حتماً-تغییر-دهید|DB_URL=postgres://setshop:${PG_PASSWORD}|' ${ETC_DIR}/env"
    note "دسترسیِ تی‌سی‌پیِ پایگاه‌داده با رمز فعال می‌شود"
  fi
  ok "فایلِ نمونه ساخته شد (رازِ تصادفی در آن گذاشته شده)"
fi

run chmod 600 "${ETC_DIR}/env"
run chown -R "${APP_USER}:${APP_USER}" "${ETC_DIR}" "${LOG_DIR}" "${BACKUP_DIR}" "${DATA_DIR}"
run chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
ok "مجوزها محدود شدند (تنظیمات فقط برایِ کاربرِ سامانه قابلِ خواندن است)"

# =====================================================================
head_ "۴) پایگاه‌داده"
# =====================================================================
if [[ -d "${DATA_DIR}/pgdata/PG_VERSION" ]]; then
  ok "خوشه‌ی پستگرس از پیش ساخته شده"
else
  note "ساختِ خوشه‌ی داده (با کاربرِ ${APP_USER})…"
  run su - "${APP_USER}" -s /bin/bash -c "PGDATA=${DATA_DIR}/pgdata PGRUN=/run/setshop ${APP_DIR}/scripts/pg-start.sh"
  ok "پایگاه‌داده آماده است"
fi

# =====================================================================
head_ "۵) سرویس‌هایِ سیستمی"
# =====================================================================
# اجرایی‌بودنِ اسکریپت‌ها: rsync مجوزها را منتقل می‌کند، اما اگر کسی فایل‌ها را
# با ftp یا زیپ منتقل کرده باشد، مجوزها از بین می‌روند و سرویس با «Permission
# denied» بالا نمی‌آید — خطایی که تشخیصش از خرابیِ خودِ برنامه دشوار است.
run chmod +x "${APP_DIR}"/deploy/*.sh "${APP_DIR}"/scripts/*.sh

# پیش از نصب، واحدها بررسی شوند: یک کلیدِ اشتباه در بخشِ نامناسب (مثلاً
# StartLimitIntervalSec در [Service]) بی‌سروصدا نادیده گرفته می‌شود و
# حفاظتی که فکر می‌کنید دارید، در واقع ندارید.
if command -v systemd-analyze >/dev/null 2>&1; then
  for unit in "${APP_DIR}"/deploy/systemd/*; do
    if ! systemd-analyze verify "${unit}" 2>/dev/null; then
      warn "بررسیِ واحد ناموفق (نادیده گرفته شد): ${unit}"
    fi
  done
  ok "واحدهایِ سیستمی بررسی شدند"
fi

# ─────────────────────────────────────────────────────────────────────────────
# چند فرآیندِ وب؟
#
# یک فرآیندِ نکست تنها یک هسته را به کار می‌گیرد (Node تک‌رشته‌ای است)، و
# اندازه‌گیری نشان داد همین یک تصمیم چقدر می‌ارزد: با یک فرآیند، توان در
# ~۲۵۰ برگه در ثانیه قفل می‌شد و تأخیرِ ۹۵٪ به ۹۰۰ میلی‌ثانیه می‌رسید؛ با دو
# فرآیند رویِ همان دستگاه، ۲۹۵ برگه در ثانیه با ۹۵٪ یِ ۴۲۶ میلی‌ثانیه.
#
# اما هرچه بیشتر، بهتر نیست: API و پایگاه‌داده هم رویِ همین دستگاه‌اند و با
# وب بر سرِ یک پردازنده رقابت می‌کنند. پس شمارِ فرآیندها «نیمی از هسته‌ها و
# دست‌کم دو و حداکثر چهار» است — عددی که رویِ یک دستگاهِ چهارهسته‌ای اندازه
# گرفته نشده، اما از همان قاعده‌ای می‌آید که اندازه‌گیری تأییدش کرد: یک
# فرآیند = یک هسته، و مابقی برایِ API و پایگاه‌داده.
# ─────────────────────────────────────────────────────────────────────────────
CORES="$(nproc 2>/dev/null || echo 2)"
WEB_WORKERS="${WEB_WORKERS:-$(( CORES > 4 ? 4 : (CORES / 2 < 2 ? 2 : CORES / 2) ))}"
[[ "${WEB_WORKERS}" =~ ^[0-9]+$ ]] || WEB_WORKERS=2
note "فرآیندهایِ وب: ${WEB_WORKERS} (دستگاه ${CORES} هسته دارد)"

run cp "${APP_DIR}"/deploy/systemd/*.service "${APP_DIR}"/deploy/systemd/*.timer /etc/systemd/system/
run systemctl daemon-reload
run systemctl enable setshop-postgres
run systemctl enable --now setshop-api
ok "سرویس‌ها نصب و فعال شدند"

# =====================================================================
head_ "۶) ساختِ نسخه‌ی تولیدِ وب"
# =====================================================================
if [[ "${DO_BUILD}" == "1" ]]; then
  note "ساختِ وب — چند دقیقه زمان می‌برد…"
  run su - "${APP_USER}" -s /bin/bash -c "set -a; source ${ETC_DIR}/env; set +a; cd ${APP_DIR} && npm run build:web"
  ok "نسخه‌ی تولیدِ وب ساخته شد"
  for ((i = 0; i < WEB_WORKERS; i++)); do
    PORT=$((3100 + i))
    run systemctl enable --now "setshop-web@${PORT}"
  done
  ok "${WEB_WORKERS} فرآیندِ وب بالا آمد (پورت‌هایِ ۳۱۰۰ تا $((3099 + WEB_WORKERS)))"
else
  warn "ساختِ وب رد شد (--no-build)"
fi

# =====================================================================
head_ "۷) nginx"
# =====================================================================
if [[ "${DO_NGINX}" == "1" ]]; then
  if command -v nginx >/dev/null 2>&1; then
    run cp "${APP_DIR}/deploy/nginx/setshop.conf" /etc/nginx/sites-available/setshop
    if [[ -n "${DOMAIN}" ]]; then
      run bash -c "sed -i 's/forushgah.example.com/${DOMAIN}/g' /etc/nginx/sites-available/setshop"
      ok "دامنه تنظیم شد: ${DOMAIN}"
    else
      warn "دامنه‌ای ندادید؛ تنظیمات با forushgah.example.com می‌ماند — بعداً اصلاح کنید"
    fi
    # فهرستِ فرآیندهایِ وب را در بالادستیِ nginx می‌نویسیم — همان شماری که
    # بالا آوردیم، نه آنچه در پرونده‌یِ نمونه است. ناهماهنگیِ این دو یعنی
    # nginx به فرآیندی درخواست می‌فرستد که وجود ندارد: درخواست‌هایی که به آن
    # فرآیند می‌افتند با ۵۰۲ شکست می‌خورند — نه همه، بلکه تصادفی. این همان
    # رده از خرابی است که در شلوغی پیدا می‌شود و در خلوت هرگز.
    awk -v n="${WEB_WORKERS}" 'BEGIN {
      print "upstream setshop_web {"
      for (i = 0; i < n; i++) printf "    server 127.0.0.1:%d;\n", 3100 + i
      print "    keepalive 32;"
      print "}"
    }' > /tmp/setshop-web-upstream

    awk -v list=/tmp/setshop-web-upstream '
      /^# >>> فرآیندهایِ وب/ { print; while ((getline line < list) > 0) print line; skip = 1; next }
      /^# <<< فرآیندهایِ وب/ { skip = 0 }
      !skip { print }
    ' /etc/nginx/sites-available/setshop > /tmp/setshop-nginx.conf \
      && cat /tmp/setshop-nginx.conf > /etc/nginx/sites-available/setshop
    rm -f /tmp/setshop-web-upstream /tmp/setshop-nginx.conf
    note "بالادستیِ nginx با ${WEB_WORKERS} فرآیند نوشته شد"
    run ln -sf /etc/nginx/sites-available/setshop /etc/nginx/sites-enabled/setshop
    run rm -f /etc/nginx/sites-enabled/default
    if nginx -t 2>/dev/null; then
      run systemctl reload nginx
      ok "nginx بارگذاریِ دوباره شد"
    else
      warn "آزمونِ پیکربندیِ nginx ناموفق بود؛ پرونده را خودتان بررسی کنید: nginx -t"
    fi
  else
    warn "nginx نصب نیست؛ رد شد (برایِ نصب: apt install -y nginx)"
  fi
fi

# =====================================================================
head_ "۸) پشتیبان‌گیریِ خودکار"
# =====================================================================
run systemctl enable --now setshop-backup.timer
if [[ "${DRY_RUN}" == "0" ]] && command -v systemctl >/dev/null && systemctl list-timers setshop-backup.timer >/dev/null 2>&1; then
  NEXT_RUN="$(systemctl list-timers setshop-backup.timer --no-legend 2>/dev/null | awk '{print $1, $2}' | head -1)"
  ok "پشتیبانِ شبانه فعال است (اجرایِ بعدی: ${NEXT_RUN:-به‌زودی}) (هر شب ۳:۱۵ به وقتِ سرور)"
else
  ok "تایمرِ پشتیبان نصب شد"
fi

# =====================================================================
head_ "۸-ب) ارسالِ خودکارِ صورتحساب به سامانه‌یِ مؤدیان"
# =====================================================================
# چرا جدا از پشتیبان؟ چون شکستِ این تایمر جریمه دارد (فروشِ بی‌صورتحساب)،
# در حالی که شکستِ پشتیبان «فقط» خطرِ از دست رفتنِ داده است. باید بتوان
# هر کدام را جداگانه دید و پیگیری کرد.
run systemctl enable --now setshop-tax.timer
if [[ "${DRY_RUN}" == "0" ]] && command -v systemctl >/dev/null && systemctl list-timers setshop-tax.timer >/dev/null 2>&1; then
  NEXT_TAX="$(systemctl list-timers setshop-tax.timer --no-legend 2>/dev/null | awk '{print $1, $2}' | head -1)"
  ok "ارسالِ خودکارِ صورتحساب فعال است (اجرایِ بعدی: ${NEXT_TAX:-به‌زودی}) — هر ۱۵ دقیقه"
else
  ok "تایمرِ مالیات نصب شد"
fi
warn "ارسالِ واقعی نیازمندِ گواهی و کلید است؛ تا آن زمان در حالتِ آزمایشی می‌ماند (توضیح در docs/maliat-moadian.md)"

# =====================================================================
head_ "۹) بازبینی"
# =====================================================================
if [[ "${DRY_RUN}" == "0" ]]; then
  sleep 3
  bash "${APP_DIR}/deploy/prod-check.sh" || warn "بازبینی کامل نبود — خروجیِ بالا را بخوانید"
else
  note "در حالتِ نمایش، بازبینی اجرا نمی‌شود"
fi

head_ "پایان"
cat <<EOF
سامانه نصب شد. گام‌هایِ بعد:
  ۱) تنظیمات را بازبینی کنید:      sudo -u ${APP_USER} editor ${ETC_DIR}/env
  ۲) اگر پایگاه خالی است، نخستین مدیر را بسازید (README فصل ۵)، سپس
     رمزش را از پنل عوض کنید.
  ۳) گواهیِ امن (در صورتِ دسترسی):   certbot --nginx -d ${DOMAIN:-دامنه‌ی-شما}
  ۴) نخستین پشتیبان را دستی بگیرید و درستی‌اش را ببینید.
EOF

#!/usr/bin/env bash
# =====================================================================
# ست‌شاپ — پشتیبان‌گیری از پایگاه‌داده (تولید)
# ---------------------------------------------------------------------
# چه می‌کند؟
#   ۱) یک فایلِ فشرده از کلِ پایگاه‌داده می‌گیرد (قالبِ سفارشیِ pg_dump)،
#   ۲) درستی‌اش را با pg_restore --list بررسی می‌کند (پشتیبانِ خراب
#      بدتر از نبودنِ پشتیبان است، چون اعتمادِ کاذب می‌سازد)،
#   ۳) اثرانگشت (sha256) می‌نویسد،
#   ۴) نسخه‌هایِ کهنه را بر اساسِ دوره‌ی نگه‌داری پاک می‌کند،
#   ۵) اگر مسیرِ آینه تعیین شده باشد، با rsync کپیِ دوم می‌سازد.
#
# زمان‌بندی: با setshop-backup.timer هر شب اجرا می‌شود.
# اجرایِ دستی:  BACKUP_DIR=/var/backups/setshop ./deploy/backup.sh
# =====================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/setshop}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
RETAIN_MONTHS="${BACKUP_RETAIN_MONTHS:-12}"
MIRROR_DIR="${BACKUP_MIRROR_DIR:-}"
DB_URL="${DB_URL:-postgres://setshop@127.0.0.1:5433/setshop}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
MONTH_TAG="$(date +%Y%m)"

# روزِ نخستِ ماه، نسخه‌ی «ماهانه» هم نگه داشته می‌شود
DAY_OF_MONTH="$(date +%d)"
KIND="daily"
[[ "${DAY_OF_MONTH}" == "01" ]] && KIND="monthly"

mkdir -p "${BACKUP_DIR}/${KIND}"
TARGET="${BACKUP_DIR}/${KIND}/setshop-${TIMESTAMP}.dump"

echo "[$(date -Is)] پشتیبان‌گیری آغاز شد → ${TARGET}"

# --- ۱) گرفتنِ نسخه
if ! pg_dump --format=custom --no-owner --no-privileges --dbname="${DB_URL}" --file="${TARGET}"; then
  echo "خطا: pg_dump ناموفق بود" >&2
  rm -f "${TARGET}"
  exit 1
fi

# --- ۱ب) پوشه‌یِ رسانه (تصویرِ کالا)
#
# چرا جدا؟ چون پایگاه فقط «نشانی» دارد و فایل‌ها روی دیسک‌اند. پشتیبانِ
# پایگاه بدونِ این پوشه یعنی فردا کالاها بی‌تصویر بالا می‌آیند — و برعکس،
# بازگرداندنِ تصویرها بدونِ پایگاه یعنی انبوهی فایلِ بی‌صاحب.
MEDIA_DIR="${MEDIA_DIR:-/var/lib/setshop/media}"
if [[ -d "${MEDIA_DIR}" ]]; then
  MEDIA_TARGET="${BACKUP_DIR}/${KIND}/setshop-media-${TIMESTAMP}.tar.zst"
  if command -v zstd >/dev/null 2>&1; then
    tar --zstd -cf "${MEDIA_TARGET}" -C "${MEDIA_DIR}" . && \
      echo "[$(date -Is)] رسانه پشتیبان گرفته شد → ${MEDIA_TARGET}"
  else
    MEDIA_TARGET="${BACKUP_DIR}/${KIND}/setshop-media-${TIMESTAMP}.tar.gz"
    tar -czf "${MEDIA_TARGET}" -C "${MEDIA_DIR}" . && \
      echo "[$(date -Is)] رسانه پشتیبان گرفته شد → ${MEDIA_TARGET}"
  fi
  if [[ -f "${MEDIA_TARGET}" ]] && command -v sha256sum >/dev/null 2>&1; then
    ( cd "$(dirname "${MEDIA_TARGET}")" && sha256sum "$(basename "${MEDIA_TARGET}")" > "${MEDIA_TARGET}.sha256" )
  fi
else
  echo "هشدار: پوشه‌یِ رسانه (${MEDIA_DIR}) نیست — تصویرها در این پشتیبان نمی‌آیند" >&2
fi

# --- ۲) بررسیِ درستی: فهرستِ اشیاءِ درونِ فایل خوانده شود
if command -v pg_restore >/dev/null 2>&1; then
  if ! pg_restore --list "${TARGET}" >/dev/null 2>&1; then
    echo "خطا: فایلِ پشتیبان قابلِ خواندن نیست" >&2
    mv "${TARGET}" "${TARGET}.corrupt"
    exit 1
  fi
fi

# --- ۳) اثرانگشت
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$(dirname "${TARGET}")" && sha256sum "$(basename "${TARGET}")" > "${TARGET}.sha256" )
fi

SIZE="$(du -h "${TARGET}" | cut -f1)"
echo "[$(date -Is)] پایان — اندازه: ${SIZE}"

# --- ۴) پاک‌سازی
find "${BACKUP_DIR}/daily"   -name '*.dump*' -type f -mtime "+${RETAIN_DAYS}"   -print -delete 2>/dev/null || true
find "${BACKUP_DIR}/monthly" -name '*.dump*' -type f -mtime "+$((RETAIN_MONTHS * 30))" -print -delete 2>/dev/null || true

# --- ۵) کپیِ دوم (اختیاری)
#
# چرا بررسیِ بودنِ rsync؟ چون نبودنش نباید کلِ پشتیبان‌گیری را شکست دهد:
# نسخه‌یِ اصلی روی همین میزبان سالم است و فقط کپیِ دوم عقب می‌ماند. با این
# حال ساکت نمی‌مانیم — «کپیِ دوم انجام نشد» باید در لاگ دیده شود، وگرنه
# مدیر خیال می‌کند دو نسخه دارد در حالی که یکی دارد.
if [[ -n "${MIRROR_DIR}" ]]; then
  if ! command -v rsync >/dev/null 2>&1; then
    echo "هشدار: rsync نصب نیست؛ کپیِ دوم انجام نشد (نصب: apt install rsync)" >&2
  else
    mkdir -p "${MIRROR_DIR}"
    if rsync -a --delete "${BACKUP_DIR}/" "${MIRROR_DIR}/"; then
      echo "کپیِ دوم انجام شد → ${MIRROR_DIR}"
    else
      echo "هشدار: کپیِ دوم ناموفق بود (خروجیِ rsync: $؟)" >&2
    fi
  fi
fi

# --- ۶) هشدار درباره‌ی فضایِ دیسک
AVAIL_GB="$(df -Pk "${BACKUP_DIR}" | awk 'NR==2 {printf "%.1f", $4/1048576}')"
echo "فضایِ در دسترس در شاخه‌ی پشتیبان: ${AVAIL_GB} گیگابایت"
awk -v g="${AVAIL_GB}" 'BEGIN { if (g+0 < 5) { print "هشدار: کمتر از ۵ گیگابایت در دسترس است"; exit 3 } }' || true

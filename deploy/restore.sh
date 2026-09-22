#!/usr/bin/env bash
# =====================================================================
# ست‌شاپ — بازگردانیِ پشتیبان (تولید)
# ---------------------------------------------------------------------
# ⚠️ بازگردانی، پایگاه‌داده‌یِ کنونی را بازنویسی می‌کند. پیش از اجرا،
#    از وضعیتِ فعلی یک نسخه بگیرید (همین اسکریپت با --pre-backup).
#
# اجرا:  ./deploy/restore.sh /var/backups/setshop/daily/setshop-20260916-031500.dump
# =====================================================================
set -euo pipefail

DUMP="${1:-}"
DB_URL="${DB_URL:-postgres://setshop@127.0.0.1:5433/setshop}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/setshop}"

if [[ -z "${DUMP}" || ! -f "${DUMP}" ]]; then
  echo "کاربرد: $0 <مسیرِ فایلِ پشتیبان>" >&2
  echo "فایل‌هایِ در دسترس:" >&2
  ls -1t /var/backups/setshop/*/*.dump 2>/dev/null | head -10 >&2 || echo "  (هیچ نسخه‌ای یافت نشد)" >&2
  exit 1
fi

# اثرانگشت بررسی شود (اگر کنارِ فایل هست)
if [[ -f "${DUMP}.sha256" ]]; then
  echo "بررسیِ اثرانگشت…"
  ( cd "$(dirname "${DUMP}")" && sha256sum -c "$(basename "${DUMP}").sha256" )
fi

# نسخه‌یِ اضطراری از وضعیتِ کنونی، پیش از بازنویسی
SAFETY="${BACKUP_DIR}/pre-restore-$(date +%Y%m%d-%H%M%S).dump"
mkdir -p "$(dirname "${SAFETY}")"
echo "نسخه‌یِ احتیاطی از وضعیتِ کنونی → ${SAFETY}"
pg_dump --format=custom --no-owner --no-privileges --dbname="${DB_URL}" --file="${SAFETY}"

echo "بازگردانی از ${DUMP}…"
# --clean: اشیاءِ موجود حذف و دوباره ساخته شوند؛ --if-exists: خطا ندهد اگر نیست
pg_restore --dbname="${DB_URL}" --clean --if-exists --no-owner --no-privileges "${DUMP}"

# --- رسانه: تصویرِ کالاها
#
# پایگاه فقط نشانی دارد؛ خودِ فایل‌ها در پوشه‌یِ رسانه‌اند. اگر بسته‌یِ رسانه
# کنارِ این نسخه باشد، هم‌زمان بازگردانی می‌شود تا کالاها بی‌تصویر نمانند.
MEDIA_DIR="${MEDIA_DIR:-/var/lib/setshop/media}"
STAMP="$(basename "${DUMP}" .dump | sed 's/^setshop-//')"
MEDIA_TAR=""
for candidate in "$(dirname "${DUMP}")/setshop-media-${STAMP}.tar.zst" "$(dirname "${DUMP}")/setshop-media-${STAMP}.tar.gz"; do
  [[ -f "${candidate}" ]] && MEDIA_TAR="${candidate}" && break
done

if [[ -n "${MEDIA_TAR}" ]]; then
  echo "بازگردانیِ رسانه از ${MEDIA_TAR}…"
  mkdir -p "${MEDIA_DIR}"
  if [[ "${MEDIA_TAR}" == *.zst ]] && command -v zstd >/dev/null 2>&1; then
    tar --zstd -xf "${MEDIA_TAR}" -C "${MEDIA_DIR}"
  else
    tar -xzf "${MEDIA_TAR}" -C "${MEDIA_DIR}"
  fi
  echo "رسانه بازگردانی شد → ${MEDIA_DIR}"
else
  echo "هشدار: بسته‌یِ رسانه کنارِ این نسخه نبود؛ تصویرها دست‌نخورده می‌مانند." >&2
fi

echo "پایان. سرویس را دوباره راه‌اندازی کنید:"
echo "  systemctl restart setshop-api setshop-web"

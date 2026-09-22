#!/usr/bin/env bash
# =====================================================================
# ست‌شاپ — بازبینیِ سلامتِ استقرار (پیش و پس از انتشار)
# ---------------------------------------------------------------------
# هر مورد را بررسی و نتیجه را با ✅ / ❌ چاپ می‌کند؛ در پایان اگر موردی
# قرمز باشد، خروجیِ اسکریپت غیرِ صفر است (مناسب برایِ CI).
#
# اجرا:  ./deploy/prod-check.sh
# =====================================================================
API_URL="${API_URL:-http://127.0.0.1:3000}"
WEB_URL="${WEB_URL:-http://127.0.0.1:3100}"
DB_URL="${DB_URL:-postgres://setshop@127.0.0.1:5433/setshop}"

FAILED=0
check() { # check "نام" "دستور" "الگویِ موردِ انتظار"
  local name="$1" out="$2" expect="$3"
  if grep -q -- "${expect}" <<<"${out}" 2>/dev/null; then
    printf '  ✅ %s\n' "${name}"
  else
    printf '  ❌ %s\n     پاسخ: %s\n' "${name}" "${out:0:200}"
    FAILED=1
  fi
}

echo "=== ۱) سرویس‌ها ==="
for svc in setshop-postgres setshop-api setshop-web; do
  if systemctl is-active --quiet "${svc}" 2>/dev/null; then
    printf '  ✅ %s فعال است\n' "${svc}"
  else
    printf '  ❌ %s فعال نیست\n' "${svc}"
    FAILED=1
  fi
done

echo "=== ۲) پایگاه‌داده ==="
check "اتصال به پایگاه‌داده" "$(psql "${DB_URL}" -tAc 'SELECT 1' 2>&1)" "1"
check "مهاجرت‌ها اعمال شده‌اند" "$(psql "${DB_URL}" -tAc "SELECT COUNT(*) FROM schema_migrations" 2>&1)" "[0-9]"
check "ترازِ دفترکل" "$(psql "${DB_URL}" -tAc "SELECT
  COALESCE(SUM(debit_rial),0) = COALESCE(SUM(credit_rial),0) FROM journal_lines" 2>&1)" "t"

echo "=== ۳) API ==="
check "سلامتِ فرآیند" "$(curl -fsS --max-time 5 "${API_URL}/health" 2>&1)" '"status":"ok"'
check "آمادگی (مهاجرت + نرخِ مالیات)" "$(curl -fsS --max-time 10 "${API_URL}/health/ready" 2>&1)" '"status"'
check "مسیرِ حسابداری محافظت‌شده است (۴۰۱)" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${API_URL}/admin/accounting/summary")" "401"

echo "=== ۴) وب‌سایت ==="
check "صفحه‌ی اصلی" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${WEB_URL}/")" "200"
check "صفحه‌ی ورودِ پنل" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${WEB_URL}/admin/login")" "200"

echo "=== ۵) مالیات و سامانه‌یِ مؤدیان ==="
# چرا این بررسی جدا است؟ چون انباشته‌شدنِ صورتحساب‌ها «خطا» نمی‌سازد: سایت
# سالم می‌ماند، فروش ادامه می‌یابد، و تنها ماه بعد با جریمه روبه‌رو می‌شویم.
# پس باید هر روز و بی‌سر و صدا دیده شود.
TAX_ROWS="$(psql "${DB_URL}" -tAc "SELECT COUNT(*) FROM tax_invoices WHERE status IN ('queued','failed','rejected')" 2>&1)"
echo "  صورتحساب‌هایِ ارسال‌نشده: ${TAX_ROWS}"
if [[ "${TAX_ROWS}" =~ ^[0-9]+$ ]] && [[ "${TAX_ROWS}" -le 50 ]]; then
  echo "  ✅ صف سبک است"
else
  echo "  ❌ صف سنگین است (بیش از ۵۰)؛ یا ارسال شکسته یا تنظیمات ناقص است"
  FAILED=1
fi
if systemctl is-active --quiet setshop-tax.timer 2>/dev/null; then
  echo "  ✅ زمان‌سنجِ ارسال فعال است"
else
  echo "  ❌ زمان‌سنجِ ارسال فعال نیست (systemctl enable --now setshop-tax.timer)"
  FAILED=1
fi
MISSING_SSTID="$(psql "${DB_URL}" -tAc "SELECT COUNT(*) FROM products WHERE status='active' AND (tax_sstid IS NULL OR tax_sstid='')" 2>&1)"
echo "  کالاهایِ بدونِ شناسه‌یِ کالا/خدمت: ${MISSING_SSTID}"
if [[ "${MISSING_SSTID}" =~ ^[0-9]+$ ]] && [[ "${MISSING_SSTID}" -eq 0 ]]; then
  echo "  ✅ همه‌یِ کالاها شناسه دارند"
else
  echo "  ❌ برخی کالاها شناسه ندارند؛ صورتحسابِ آن‌ها رد می‌شود"
  FAILED=1
fi

echo "=== ۶) منابع ==="
MEM_FREE="$(free -m | awk 'NR==2 {print $7}')"
echo "  حافظه‌ی در دسترس: ${MEM_FREE} مگابایت"
[[ "${MEM_FREE}" -lt 300 ]] && { echo "  ❌ حافظه کم است"; FAILED=1; } || echo "  ✅ حافظه کافی است"
DISK="$(df -P / | awk 'NR==2 {print $5}' | tr -d '%')"
echo "  فضایِ دیسکِ مصرف‌شده: ${DISK}٪"
[[ "${DISK}" -gt 85 ]] && { echo "  ❌ دیسک نزدیکِ پر شدن است"; FAILED=1; } || echo "  ✅ فضایِ دیسک کافی است"

echo
if [[ "${FAILED}" -eq 0 ]]; then
  echo "همه‌ی بررسی‌ها سبز است ✅"
else
  echo "برخی بررسی‌ها قرمز است ❌"
fi
exit "${FAILED}"

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# نمایشِ یک روزِ کاملِ فروشگاه — از خریدِ کالا تا سندِ حسابداری.
#
# این اسکریپت «داده‌ی نمونه» نمی‌سازد؛ زنجیره‌ی واقعی را روی سرورِ در حالِ
# اجرا انجام می‌دهد تا بشود دید هر تومان از کجا آمد و کجا رفت:
#
#   ۱) فاکتورِ خرید از تأمین‌کننده  ← انبار پر می‌شود + بدهی ثبت می‌گردد
#   ۲) فروشِ حضوری (صندوق)          ← نقد به صندوق می‌رود + کالا از انبار می‌رود
#   ۳) فروشِ اینترنتی با درگاه      ← پول به بانک می‌رود + سفارش تسویه می‌شود
#   ۴) گزارش‌ها                     ← ترازِ آزمایشی، سود و زیان، ارزشِ موجودی
#
# اجرا:
#   ./scripts/pg-start.sh            # اگر پایگاه خاموش است
#   API=... npm run start:api        # سرور
#   ./scripts/demo-flow.sh
# ---------------------------------------------------------------------------
set -euo pipefail

API="${API:-http://127.0.0.1:3000}"
DB_URL="${DB_URL:-postgres://setshop@/setshop?host=/tmp/pgrun&port=5433}"
WEB="${WEB:-http://127.0.0.1:3100}"

# خواندنِ یک فیلد از پاسخِ JSON؛ اگر پاسخ خطا باشد، پیامِ خطا را نشان می‌دهد
j() { python3 -c "
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    print('پاسخ نامعتبر: ' + raw[:120]); sys.exit(0)
if 'error' in d:
    print('خطا: ' + str(d['error'].get('message')) + ' ' + str(d['error'].get('details') or '')); sys.exit(0)
try:
    print($1)
except Exception as e:
    print('خطا در خواندنِ پاسخ: ' + repr(e) + ' | ' + raw[:160])
" || echo ""; }
q() { psql "$DB_URL" -At -c "$1"; }
line() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# --- ورود ------------------------------------------------------------------
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d '{"mobile":"09120000000","password":"SetShop@1404"}' | j "d['accessToken']")
AUTH_H="authorization: Bearer $TOKEN"
[ -n "$TOKEN" ] || { echo "ورود ناموفق — ابتدا سرور را اجرا کنید"; exit 1; }

[ -n "$(q "SELECT 1")" ] || { echo "پایگاه‌داده در دسترس نیست — ابتدا ./scripts/pg-start.sh را اجرا کنید"; exit 1; }
WAREHOUSE=$(q "SELECT id FROM warehouses LIMIT 1")
V1=$(q "SELECT id FROM product_variants WHERE sku='CS-13P-BLK'")
V2=$(q "SELECT id FROM product_variants WHERE sku='CH-20W-WHT'")
[ -n "$V1" ] && [ -n "$V2" ] || { echo "کالاهایِ نمونه پیدا نشدند — ابتدا یک‌بار API را اجرا کنید تا داده‌ی نمونه ساخته شود"; exit 1; }

line "۱) فاکتورِ خرید از تأمین‌کننده (ورودِ کالا به انبار)"
PURCHASE=$(curl -s -X POST "$API/admin/accounting/purchases" -H "$AUTH_H" -H 'content-type: application/json' -d "{
  \"supplierName\":\"شرکتِ پارس‌الکترونیک\",
  \"supplierNationalId\":\"1010123459\",
  \"supplierEconomicCode\":\"411522334455\",
  \"supplierInvoiceNo\":\"INV-$(date +%s)\",
  \"warehouseId\":\"$WAREHOUSE\",
  \"items\":[{\"variantId\":\"$V1\",\"quantity\":20,\"unitCostRial\":\"1750000\"},
            {\"variantId\":\"$V2\",\"quantity\":30,\"unitCostRial\":\"620000\"}],
  \"extraCostRial\":\"150000\",
  \"vatRial\":\"0\"
}")
echo "$PURCHASE" | j "f\"شماره: {d['invoiceNo']} | خالص: {d['subtotalRial']} | هزینه‌ی جانبی: {d['extraCostRial']} | قابلِ پرداخت: {d['payableRial']}\""
echo "سندِ حسابداری: $(echo "$PURCHASE" | j "d['entryNo']")"
echo "بهای میانگینِ CS-13P-BLK پس از خرید: $(q "SELECT avg_cost_rial FROM inventory_valuation WHERE variant_id='$V1'")"

line "۲) فروشِ حضوری (صندوق)"
# شیفتِ باز را پیدا می‌کنیم؛ اگر باز نباشد، یکی باز می‌کنیم
# (چرا؟ چون اجرایِ دوباره‌ی این اسکریپت نباید با خطایِ «شیفت از قبل باز است» بشکند)
SHIFT_ID=$(curl -s "$API/pos/shifts?status=open" -H "$AUTH_H" | j "(d.get('shifts') or d.get('items') or [{}])[0].get('id','')")
if [ -z "$SHIFT_ID" ] || [ "$SHIFT_ID" = "None" ]; then
  SHIFT_ID=$(curl -s -X POST "$API/pos/shifts/open" -H "$AUTH_H" -H 'content-type: application/json' \
    -d "{\"warehouseId\":\"$WAREHOUSE\",\"openingCashRial\":\"500000\"}" | j "d['shiftId']")
  echo "شیفتِ تازه باز شد: $SHIFT_ID (موجودیِ آغازین: ۵۰۰٬۰۰۰ تومان)"
else
  echo "ادامه‌ی شیفتِ باز: $SHIFT_ID"
fi
SALE=$(curl -s -X POST "$API/pos/shifts/$SHIFT_ID/sell" -H "$AUTH_H" -H 'content-type: application/json' -d "{
  \"items\":[{\"variantId\":\"$V1\",\"quantity\":2}],
  \"paymentMethod\":\"cash\",
  \"customerName\":\"مشتریِ حضوری\"
}")
echo "$SALE" | j "f\"سفارش: {d['orderNo']} | مبلغ: {d['totalRial']} ریال | سند: {d.get('entryNo','-')}\""
CLOSED=$(curl -s -X POST "$API/pos/shifts/$SHIFT_ID/close" -H "$AUTH_H" -H 'content-type: application/json' -d "{\"countedCashRial\":\"5000000\",\"note\":\"پایانِ روز\"}")
echo "بستنِ شیفت: $(echo "$CLOSED" | j "d.get('shiftNo') or d.get('shiftId') or 'بسته شد'") | مغایرتِ نقد: $(echo "$CLOSED" | j "d.get('differenceRial','-')") ریال"

line "۳) فروشِ اینترنتی با درگاهِ پرداخت"
CART=$(curl -s -X POST "$API/cart" -H 'content-type: application/json' -d '{"channel":"web"}' | j "d['cartId']")
curl -s -X POST "$API/cart/$CART/items" -H 'content-type: application/json' -d "{\"variantId\":\"$V2\",\"quantity\":3}" >/dev/null
ORDER=$(curl -s -X POST "$API/cart/$CART/checkout" -H 'content-type: application/json' -d "{
  \"idempotencyKey\":\"demo-$(date +%s)\",
  \"customerName\":\"سارا احمدی\",
  \"customerMobile\":\"09120000009\",
  \"shippingAddress\":\"تهران، خیابانِ آزادی، پلاک ۱، واحد ۲\"
}")
OID=$(echo "$ORDER" | j "d['orderId']")
echo "$ORDER" | j "f\"سفارش: {d['orderNo']} | مبلغ: {d['totalRial']} ریال ({d['display']['total']} تومان)\""
START=$(curl -s -X POST "$API/payments/start" -H 'content-type: application/json' -d "{\"orderId\":\"$OID\"}")
AUTHORITY=$(echo "$START" | j "d['authority']")
echo "درگاه: $(echo "$START" | j "d['gateway']") | نشانیِ هدایت: $(echo "$START" | j "d['redirectUrl']")"
echo "(در مرورگر: همین نشانی را باز کنید، «پرداختِ موفق» را بزنید)"
curl -s -X POST "$WEB/api/payments/sandbox/$AUTHORITY/decision" -H 'content-type: application/json' -d '{"decision":"paid"}' >/dev/null
echo "تأیید: $(curl -s -X POST "$API/payments/verify" -H 'content-type: application/json' -d "{\"authority\":\"$AUTHORITY\"}" | j "f\"{d['status']} | پیگیری {d.get('refId','-')}\"")"
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "$WEB/pay/callback?Authority=$AUTHORITY&Status=OK")
echo "بازگشت از درگاه: ${LOC#$WEB}"
echo "صفحه‌ی نتیجه: $(curl -s "$LOC" | grep -c 'پرداخت با موفقیت انجام شد') بار «پرداخت با موفقیت انجام شد»"

line "۴) گزارش‌ها"
curl -s "$API/admin/accounting/trial-balance" -H "$AUTH_H" | j "f\"ترازِ آزمایشی: balanced={d['balanced']} | بدهکار {d['totals']['debit']} | بستانکار {d['totals']['credit']}\""
curl -s "$API/admin/accounting/profit-loss" -H "$AUTH_H" | j "f\"سود و زیان: درآمد {d['revenue']['display']} | بهای کالا {d['cogs']['display']} | سودِ ناخالص {d['grossProfit']['display']} | هزینه‌ها {d['expenses']['display']} | سودِ خالص {d['netProfit']['display']} تومان\""
curl -s "$API/admin/accounting/inventory-value" -H "$AUTH_H" | j "f\"ارزشِ موجودی: {d['totalQuantity']} عدد | {d['display']['total']} تومان\""
echo "موجودیِ CS-13P-BLK در انبار: $(q "SELECT on_hand FROM stock_items WHERE variant_id='$V1'")"
echo "تعدادِ ردیف‌هایِ پرداختِ این سفارش (باید ۱ باشد): $(q "SELECT COUNT(*) FROM payments WHERE order_id='$OID'")"
line "پایان — همه‌ی مراحل بدون خطا انجام شد"

#!/bin/bash
# اسکریپت برای تغییر پسوند 9999.zip.txt به 9999.zip و اکسترکت در گیت‌هاب
# استفاده: ./extract_9999.sh [مسیر فایل]
set -e
SRC="${1:-/home/user/uploads/9999.zip.txt}"
DST="/home/user/webj/9999.zip"
echo "🔍 بررسی فایل منبع: $SRC"
if [ ! -f "$SRC" ]; then
  echo "❌ فایل پیدا نشد: $SRC"
  echo "   لطفا فایل را دوباره آپلود کنید یا مسیر درست را بدهید"
  ls -lh /home/user/uploads/ 2>&1 || echo "پوشه uploads خالی است"
  exit 1
fi
echo "📦 اندازه فایل: $(wc -c < "$SRC") بایت"
echo "🔄 تغییر نام به $DST"
cp "$SRC" "$DST"
ls -lh "$DST"
echo "📂 اکسترکت با پایتون (zipfile)..."
python3 - << 'PY'
import zipfile, pathlib, sys
zip_path = pathlib.Path("/home/user/webj/9999.zip")
dest = pathlib.Path("/home/user/webj")
try:
    with zipfile.ZipFile(zip_path) as z:
        print("📋 محتویات زیپ:")
        for info in z.infolist():
            print(f"  - {info.filename} ({info.file_size} bytes)")
        z.extractall(dest)
        print("✅ اکسترکت موفق!")
except zipfile.BadZipFile as e:
    print(f"❌ فایل زیپ خراب است: {e}")
    sys.exit(1)
except Exception as e:
    print(f"❌ خطا: {e}")
    import traceback; traceback.print_exc()
    sys.exit(1)
PY
echo "📁 فایل‌های اکسترکت شده:"
ls -R /home/user/webj | head -n 100
echo "✅ حذف فایل‌های موقت zip و txt (اختیاری)"
# rm "$DST"
# rm "$SRC"
echo "برای کامیت در گیت‌هاب:"
echo "  git add ."
echo "  git commit -m 'add extracted 9999.zip contents'"
echo "  git push origin arena/01a0c818-webj"

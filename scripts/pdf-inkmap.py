"""نقشه‌یِ مرکبِ یک برگه‌یِ پی‌دی‌اف — برایِ دیدنِ چیدمان بی‌چشم.

چرا؟ چون کیفیتِ یک خروجیِ چاپی با «خواندنِ متنِ استخراج‌شده» معلوم نمی‌شود:
هم‌پوشانیِ ستون‌ها، بیرون‌زدن از حاشیه، و ردیف‌هایِ روی‌هم‌افتاده را فقط در
تصویر می‌شود دید. این ابزار تصویر را به یک نقشه‌یِ متنیِ فشرده تبدیل می‌کند
تا بشود در ترمینال (و در گزارشِ خودکار) دیدش.

کاربرد:
  python3 scripts/pdf-inkmap.py file.pdf [برگه] [دقت]
"""
import subprocess
import sys
import tempfile
import os

from PIL import Image


def render(path: str, page: int, dpi: int) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        prefix = os.path.join(tmp, "p")
        subprocess.run(
            ["pdftoppm", "-png", "-r", str(dpi), "-f", str(page), "-l", str(page), path, prefix],
            check=True,
        )
        files = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))
        return Image.open(os.path.join(tmp, files[0])).convert("L")


def main() -> int:
    path = sys.argv[1]
    page = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    cols = 118

    img = render(path, page, dpi)
    w, h = img.size
    rows = max(1, int(cols * h / w / 2.1))
    small = img.resize((cols, rows), Image.BOX)
    px = small.load()

    # آستانه از رویِ خودِ تصویر: روشن‌ترین و تیره‌ترینِ واقعی
    values = [px[x, y] for y in range(rows) for x in range(cols)]
    dark = min(values)
    light = max(values)
    threshold = dark + (light - dark) * 0.55

    print(f"برگه‌یِ {page}: {w}×{h} نقطه در {dpi} dpi — آستانه‌یِ مرکب {threshold:.0f}")
    print("+" + "-" * cols + "+")
    for y in range(rows):
        line = "".join("#" if px[x, y] < threshold else ("." if px[x, y] < light - 4 else " ") for x in range(cols))
        print("|" + line + "|")
    print("+" + "-" * cols + "+")

    # حاشیه‌ها: مرکب نباید از ناحیه‌یِ امن بیرون بزند
    margin_px = int(36 * dpi / 72) - 2
    ink = [(x, y) for y in range(h) for x in range(w) if img.load()[x, y] < 150]
    if ink:
        xs = [p[0] for p in ink]
        ys = [p[1] for p in ink]
        print(
            f"محدوده‌یِ مرکب: x {min(xs)}..{max(xs)} (از {w})، y {min(ys)}..{max(ys)} (از {h})، "
            f"حاشیه‌یِ امن {margin_px} نقطه"
        )
        outside = sum(1 for x, y in ink if x < margin_px or x > w - margin_px or y > h - int(20 * dpi / 72))
        print(f"نقطه‌هایِ بیرون از حاشیه: {outside}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

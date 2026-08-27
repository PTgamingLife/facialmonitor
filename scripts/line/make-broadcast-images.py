#!/usr/bin/env python3
"""
產生群發圖文的主視覺(1560x1014)

尺寸是 20:13 —— infoCard 的 hero 就是這個比例且 aspectMode: cover,
比例不對就會被裁掉。作法跟 make-richmenu-images.py 一樣用 Pillow 直接畫:
改文案重跑就好,不用重新生成再挑。

排版刻意走文字主導,不放圖示。卡片上已經有標題與內文,
圖再畫一次同樣的意思只是變吵 —— 圖要說的是「感覺」,不是「資訊」。

執行:
    python3 scripts/line/make-broadcast-images.py

輸出:
    img/broadcast/*.png
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "img" / "broadcast"

W, H = 1560, 1014          # 20:13
PAD = 110

# 品牌指南「看·健」
BG        = (255, 255, 255)
DEEP      = ( 13,  92,  99)   # 深海青 — 標題
PRIMARY   = ( 34, 193, 195)   # 健康青 — 重點
PALE      = (230, 247, 248)   # 健康青淡底
TEXT_SOFT = (143, 163, 184)   # 藍灰 — 只用在小字

FONT_CANDIDATES = [
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 3),
    ("C:/Windows/Fonts/msjhbd.ttc", 0),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
]


def _resolve_font():
    for path, index in FONT_CANDIDATES:
        if Path(path).exists():
            return path, index
    raise SystemExit("找不到可用的中文字型,請安裝 fonts-noto-cjk")


FONT_PATH, FONT_INDEX = _resolve_font()


def font(size):
    return ImageFont.truetype(FONT_PATH, size, index=FONT_INDEX)


# 圖上的字跟卡片標題刻意不同 —— 標題負責講清楚,圖負責先讓人停下來。
# accent 是要用健康青標出來的那幾個字(整行比對,不是逐字)。
SLIDES = [
    ("free-credit",  ["1 次免費檢測", "在等你用掉"],        "1 次免費檢測"),
    ("lottery",      ["首檢就送一次", "每抽必中"],          "每抽必中"),
    ("why-face",     ["臉和舌頭", "藏著答案"],              "藏著答案"),
    ("record",       ["身體的變化", "是連續的"],            "是連續的"),
    ("together",     ["一個人容易放棄", "兩個人走得下去"],  "兩個人走得下去"),
    ("tongue",       ["今天的舌苔", "跟昨天不一樣"],        "跟昨天不一樣"),
]


def draw_slide(lines, accent_line):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)

    # 右側一顆超出畫面的淡色圓。留白太乾淨會顯得空,
    # 但放滿圖案又會跟字搶 —— 一個切邊的形狀剛好。
    r = 430
    d.ellipse([W - r, H // 2 - r - 60, W + r, H // 2 + r - 60], fill=PALE)
    d.ellipse([W - 150, H // 2 + 150, W - 150 + 76, H // 2 + 226], fill=PRIMARY)

    # 標題上方的短橫 —— 給視線一個起點
    d.rectangle([PAD, PAD + 40, PAD + 132, PAD + 52], fill=PRIMARY)

    size = 104
    f = font(size)
    gap = 34
    total = len(lines) * size + (len(lines) - 1) * gap
    y = (H - total) // 2 + 30

    for line in lines:
        d.text((PAD, y), line, font=f, fill=PRIMARY if line == accent_line else DEEP)
        y += size + gap

    small = font(30)
    d.text((PAD, H - PAD - 10), "看·健　面舌診檢測", font=small, fill=TEXT_SOFT)
    return im


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for key, lines, accent in SLIDES:
        im = draw_slide(lines, accent)
        path = OUT / f"{key}.png"
        im.save(path, "PNG", optimize=True)
        print(f"✔ {path.relative_to(ROOT)}  {W}x{H}  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
產生 2 分頁圖文選單底圖(2500x1686)

用 Pillow 直接畫,不用 AI 生圖。理由:
  - 尺寸精準到 px,格線與 richmenu-config.json 的點擊區塊完全對齊
  - 中文字用真字型渲染,不會缺筆畫或變形
  - 改文案就重跑,不用重新生成再挑

執行:
    python3 scripts/line/make-richmenu-images.py

輸出:
    img/richmenu-health.png
    img/richmenu-reward.png
"""

from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "img"

W, H = 2500, 1686
TAB_H = 222
COLS, ROWS = 2, 2
CELL_H = 732
COL_X = [0, 1250]
COL_W = [1250, 1250]
ROW_Y = [TAB_H, TAB_H + CELL_H]

# 品牌指南「看·健」的六個色 + 兩個補色
# (補的兩個:icon 底圈需要一個健康青的淡底;格線需要一條比淺灰更輕的線)
BG        = (255, 255, 255)   # #FFFFFF 純白
LINE_COL  = (230, 236, 241)   # #E6ECF1 淺灰 — 格線
TAB_OFF   = (230, 236, 241)   # #E6ECF1 淺灰 — 未選中分頁
                              # 用藍灰的話，上面的深海青字對比不夠，看起來像失效的按鈕
TAB_ON    = ( 13,  92,  99)   # #0D5C63 深海青 — 選中分頁
ICON_COL  = ( 34, 193, 195)   # #22C1C3 健康青 — icon 線條
ICON_BG   = (230, 247, 248)   # 健康青淡底(補)
TEXT_DARK = ( 13,  92,  99)   # #0D5C63 深海青 — 標籤字
TEXT_MID  = ( 65,  86,  95)   # 內文(補)
WHITE     = (255, 255, 255)

# 字型:一律用粗體。圖文選單在手機上只有指甲大,細體的筆畫會糊成一團。
# 依序找,找到第一個可用的就用。.ttc 是字型集,要指定 index 才拿得到繁體那一套。
#   Noto Sans CJK TC Bold  — 開源、字面大、繁體字形正確(Ubuntu: fonts-noto-cjk)
#   微軟正黑體 Bold        — Windows 上跑這支腳本時的替代
#   文泉驛正黑             — 最後的退路,只有 Regular,會比較細
FONT_CANDIDATES = [
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 3),
    ("C:/Windows/Fonts/msjhbd.ttc", 0),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
]


def _resolve_font():
    for path, index in FONT_CANDIDATES:
        if Path(path).exists():
            return path, index
    raise SystemExit(
        "找不到可用的中文字型。Ubuntu 裝:sudo apt install fonts-noto-cjk"
    )


FONT_PATH, FONT_INDEX = _resolve_font()

TABS = [
    {
        "key": "health",
        "tab_labels": ["健康", "推薦"],
        "active": 0,
        "cells": [
            ("面舌診檢測", "scan"),
            ("我的健康分數", "chart"),
            ("每日挑戰",   "check"),
            ("兌換 / 抽獎", "gift"),
        ],
    },
    {
        "key": "reward",
        "tab_labels": ["健康", "推薦"],
        "active": 1,
        "cells": [
            ("剩餘次數",   "ticket"),
            ("詢問顧問",   "doctor"),
            ("我推薦的人", "people"),
            ("分享推薦",   "share"),
        ],
    },
]


def font(size):
    return ImageFont.truetype(FONT_PATH, size, index=FONT_INDEX)


def fit_font(d, text, max_w, start, floor=64):
    """從 start 開始縮到塞得進 max_w 為止。標籤長短不一,固定字級會爆格。"""
    size = start
    while size > floor:
        f = font(size)
        left, _, right, _ = d.textbbox((0, 0), text, font=f)
        if right - left <= max_w:
            return f
        size -= 4
    return font(floor)


def center_text(d, box, text, f, fill):
    """把文字置中在 (x, y, w, h) 方框裡"""
    x, y, w, h = box
    left, top, right, bottom = d.textbbox((0, 0), text, font=f)
    d.text((x + (w - (right - left)) / 2 - left,
            y + (h - (bottom - top)) / 2 - top), text, font=f, fill=fill)


def draw_icon(d, cx, cy, r, kind, ink=ICON_COL, plate=ICON_BG):
    """簡單的線條 icon。畫在半徑 r 的底圈中央;線寬跟著 r 等比縮放。"""
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=plate)
    # 9 是半徑 76 時的線寬。放大底圈卻不加粗線條,icon 會顯得比原本更虛。
    c, lw = ink, max(3, round(6 * r / 76))
    s = r * 0.52   # icon 本體的半徑

    if kind == "scan":            # 掃描框 + 中央圓(面舌診)
        for dx, dy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
            x, y = cx + dx * s, cy + dy * s
            d.line([x, y, x - dx * s * 0.45, y], fill=c, width=lw)
            d.line([x, y, x, y - dy * s * 0.45], fill=c, width=lw)
        d.ellipse([cx - s * 0.40, cy - s * 0.65, cx + s * 0.40, cy + s * 0.38],
                  outline=c, width=lw)
        d.arc([cx - s * 0.64, cy + s * 0.20, cx + s * 0.64, cy + s * 1.1],
              195, 345, fill=c, width=lw)
    elif kind == "doc":           # 文件 + 三條線
        d.rounded_rectangle([cx - s * 0.72, cy - s, cx + s * 0.72, cy + s],
                            radius=12, outline=c, width=lw)
        for i, k in enumerate((-0.42, 0.0, 0.42)):
            d.line([cx - s * 0.4, cy + s * k, cx + s * (0.4 - i * 0.14), cy + s * k],
                   fill=c, width=lw - 2)
    elif kind == "chart":         # 上升折線
        pts = [(cx - s, cy + s * 0.6), (cx - s * 0.3, cy - s * 0.1),
               (cx + s * 0.2, cy + s * 0.25), (cx + s, cy - s * 0.7)]
        d.line(pts, fill=c, width=lw, joint="curve")
        d.ellipse([cx + s - 11, cy - s * 0.7 - 11, cx + s + 11, cy - s * 0.7 + 11], fill=c)
    elif kind == "ticket":        # 票券:外框 + 右側撕線
        d.rounded_rectangle([cx - s, cy - s * 0.62, cx + s, cy + s * 0.62],
                            radius=14, outline=c, width=lw)
        yy, y_end = cy - s * 0.4, cy + s * 0.4
        while yy < y_end:        # 虛線比缺口好認,缺口在小尺寸下會被誤讀成方括號
            d.line([cx + s * 0.34, yy, cx + s * 0.34, min(yy + 11, y_end)],
                   fill=c, width=lw - 3)
            yy += 22
    elif kind == "check":         # 圓圈打勾
        d.ellipse([cx - s, cy - s, cx + s, cy + s], outline=c, width=lw)
        d.line([(cx - s * 0.42, cy), (cx - s * 0.1, cy + s * 0.38), (cx + s * 0.48, cy - s * 0.36)],
               fill=c, width=lw, joint="curve")
    elif kind == "chat":          # 對話框
        d.rounded_rectangle([cx - s, cy - s * 0.78, cx + s, cy + s * 0.4],
                            radius=20, outline=c, width=lw)
        d.polygon([(cx - s * 0.28, cy + s * 0.4), (cx - s * 0.02, cy + s * 0.4),
                   (cx - s * 0.34, cy + s * 0.9)], fill=c)
    elif kind == "link":          # 連結環
        d.arc([cx - s, cy - s * 0.5, cx + s * 0.1, cy + s * 0.5], 40, 320, fill=c, width=lw)
        d.arc([cx - s * 0.1, cy - s * 0.5, cx + s, cy + s * 0.5], 220, 140, fill=c, width=lw)
    elif kind == "angel":         # 翅膀 + 光圈
        d.arc([cx - s * 1.05, cy - s * 0.25, cx - s * 0.05, cy + s * 0.95], 180, 350, fill=c, width=lw)
        d.arc([cx + s * 0.05, cy - s * 0.25, cx + s * 1.05, cy + s * 0.95], 190, 360, fill=c, width=lw)
        d.ellipse([cx - s * 0.42, cy - s * 0.95, cx + s * 0.42, cy - s * 0.5], outline=c, width=lw)
    elif kind == "pen":           # 筆:斜的筆桿 + 左下筆尖 + 底線
        # 用向量畫,筆桿要有寬度才不會被看成箭頭(單線 + 三角形頭 = 箭頭)
        ux, uy = 0.707, -0.707            # 筆桿方向(左下 → 右上)
        vx, vy = 0.707, 0.707             # 垂直方向
        def P(t, n):                      # t = 沿筆桿,n = 側向偏移
            return (cx + (ux * t + vx * n) * s, cy + (uy * t + vy * n) * s)
        d.polygon([P(-0.1, -0.24), P(0.95, -0.24), P(0.95, 0.24), P(-0.1, 0.24)],
                  outline=c, fill=None, width=lw - 2)
        d.polygon([P(-0.1, -0.24), P(-0.1, 0.24), P(-0.6, 0.0)], fill=c)   # 筆尖
        d.line([P(0.62, -0.24), P(0.62, 0.24)], fill=c, width=lw - 3)      # 筆桿分節
        d.line([(cx - s * 0.7, cy + s * 0.98), (cx + s * 0.55, cy + s * 0.98)],
               fill=c, width=lw - 2)      # 底線:表示「寫在紙上」
    elif kind == "people":        # 兩個人
        for dx, rr in ((-0.42, 0.30), (0.42, 0.30)):
            d.ellipse([cx + s * dx - s * rr, cy - s * 0.72, cx + s * dx + s * rr, cy - s * 0.72 + s * 2 * rr],
                      outline=c, width=lw)
            d.arc([cx + s * dx - s * 0.62, cy - s * 0.18, cx + s * dx + s * 0.62, cy + s * 1.0],
                  200, 340, fill=c, width=lw)
    elif kind == "calendar":      # 日曆
        d.rounded_rectangle([cx - s, cy - s * 0.75, cx + s, cy + s * 0.85], radius=14, outline=c, width=lw)
        d.line([cx - s, cy - s * 0.22, cx + s, cy - s * 0.22], fill=c, width=lw)
        d.line([cx - s * 0.5, cy - s * 1.0, cx - s * 0.5, cy - s * 0.52], fill=c, width=lw)
        d.line([cx + s * 0.5, cy - s * 1.0, cx + s * 0.5, cy - s * 0.52], fill=c, width=lw)
    elif kind == "share":         # 分享:三個點 + 兩條連線
        d.ellipse([cx + s * 0.35, cy - s * 0.95, cx + s * 0.95, cy - s * 0.35], outline=c, width=lw)
        d.ellipse([cx - s * 0.95, cy - s * 0.3, cx - s * 0.35, cy + s * 0.3], outline=c, width=lw)
        d.ellipse([cx + s * 0.35, cy + s * 0.35, cx + s * 0.95, cy + s * 0.95], outline=c, width=lw)
        d.line([cx - s * 0.32, cy - s * 0.14, cx + s * 0.34, cy - s * 0.52], fill=c, width=lw - 2)
        d.line([cx - s * 0.32, cy + s * 0.14, cx + s * 0.34, cy + s * 0.52], fill=c, width=lw - 2)
    elif kind == "doctor":        # 顧問:人 + 胸前十字
        # 肩膀弧線要離頭夠遠、也要夠寬,不然十字看起來像浮在頭下面的「＋」,
        # 整個 icon 會被讀成「加好友」。
        d.ellipse([cx - s * 0.32, cy - s * 1.0, cx + s * 0.32, cy - s * 0.36],
                  outline=c, width=lw)
        d.arc([cx - s * 0.98, cy - s * 0.05, cx + s * 0.98, cy + s * 1.9],
              200, 340, fill=c, width=lw)
        d.line([cx, cy + s * 0.34, cx, cy + s * 0.86], fill=c, width=lw - 2)   # 十字直
        d.line([cx - s * 0.26, cy + s * 0.6, cx + s * 0.26, cy + s * 0.6],
               fill=c, width=lw - 2)                                            # 十字橫
    elif kind == "cart":          # 購物車
        d.line([cx - s * 0.95, cy - s * 0.6, cx - s * 0.55, cy - s * 0.6], fill=c, width=lw)
        d.line([(cx - s * 0.55, cy - s * 0.6), (cx - s * 0.2, cy + s * 0.35),
                (cx + s * 0.8, cy + s * 0.35)], fill=c, width=lw, joint="curve")
        d.line([(cx - s * 0.42, cy - s * 0.2), (cx + s * 0.95, cy - s * 0.2),
                (cx + s * 0.8, cy + s * 0.35)], fill=c, width=lw, joint="curve")
        for dx in (-0.05, 0.62):
            d.ellipse([cx + s * dx - 13, cy + s * 0.72 - 13, cx + s * dx + 13, cy + s * 0.72 + 13], fill=c)
    elif kind == "gift":          # 禮物盒:盒身 + 盒蓋 + 蝴蝶結
        # 沒有蝴蝶結時,盒身加中線會被看成窗框 —— 結是辨識關鍵
        d.rounded_rectangle([cx - s * 0.82, cy - s * 0.1, cx + s * 0.82, cy + s * 0.92],
                            radius=10, outline=c, width=lw)
        d.rounded_rectangle([cx - s, cy - s * 0.46, cx + s, cy - s * 0.06],
                            radius=8, outline=c, width=lw)
        d.line([cx, cy - s * 0.06, cx, cy + s * 0.92], fill=c, width=lw)   # 只在盒身畫緞帶
        d.ellipse([cx - s * 0.66, cy - s * 0.92, cx - s * 0.04, cy - s * 0.44],
                  outline=c, width=lw - 2)
        d.ellipse([cx + s * 0.04, cy - s * 0.92, cx + s * 0.66, cy - s * 0.44],
                  outline=c, width=lw - 2)
    elif kind == "coin":          # 寶石:上緣一條 + 兩側斜面收到底尖 + 兩條刻面線
        # 不畫成硬幣(圓中圓) —— 那個在縮圖裡會被看成同心圓,認不出是積分
        top, bot = cy - s * 0.42, cy + s * 0.92
        lx, rx = cx - s * 0.92, cx + s * 0.92
        d.line([lx, top, rx, top], fill=c, width=lw)          # 上緣
        d.line([lx, top, cx, bot], fill=c, width=lw)          # 左斜面
        d.line([rx, top, cx, bot], fill=c, width=lw)          # 右斜面
        d.line([lx + (rx - lx) / 3, top, cx, bot], fill=c, width=lw - 3)   # 刻面
        d.line([rx - (rx - lx) / 3, top, cx, bot], fill=c, width=lw - 3)


# Presentation only: labels and hit geometry are read from the live config.
DETAILS = {
    "scan": ("拍攝臉部與舌頭", "deep"),
    "chart": ("查看最新檢測結果", "blue"),
    "check": ("完成任務・累積健康", "mint"),
    "gift": ("積點換好禮", "sand"),
    "ticket": ("查看可用檢測次數", "mint"),
    "doctor": ("健康問題・專人協助", "deep"),
    "people": ("查看好友推薦紀錄", "blue"),
    "share": ("邀請好友一起加入", "sand"),
}
PALETTES = {
    "deep": ("#0B424A", "#13757A", "#FFFFFF", "#C7ECE9", "#286D73", "#F0FFFF"),
    "blue": ("#F4F9FD", "#DFEBF5", "#163F59", "#486379", "#D0E2F0", "#2A658A"),
    "mint": ("#F1FAF7", "#D9EEE8", "#164D49", "#446C64", "#C8E3DA", "#216C61"),
    "sand": ("#FCF8F0", "#EFE5D2", "#614B2E", "#756247", "#E9DCC2", "#896735"),
}


def rgb(value):
    return tuple(int(value[i:i+2], 16) for i in (1, 3, 5))


def gradient(size, first, last):
    strip = Image.new("RGB", (1, size[1]))
    a, b = rgb(first), rgb(last)
    strip.putdata([tuple(round(a[k] + (b[k]-a[k])*y/(size[1]-1))
                         for k in range(3)) for y in range(size[1])])
    return strip.resize(size)


def build(tab):
    config = json.loads((ROOT / "scripts/line/richmenu-config.json").read_text(encoding="utf-8"))
    layout = config["layout"]
    assert config["canvas"] == {"width": W, "height": H}
    assert (layout["tabBarHeight"], layout["cellHeight"], layout["cols"], layout["rows"]) == (TAB_H, CELL_H, COLS, ROWS)
    source = next(t for t in config["tabs"] if t["key"] == tab["key"])
    assert len(source["cells"]) == len(tab["cells"]) == COLS * ROWS
    img = Image.new("RGB", (W, H), "#ECF1EF")
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, TAB_H-1), fill="#0B424A")
    for i, label in enumerate(tab["tab_labels"]):
        x = i * 1250
        on = i == tab["active"]
        if on:
            d.rounded_rectangle((x+38, 28, x+1212, TAB_H-28), radius=58, fill="#F1FAF7")
        center_text(d, (x, 20, 1250, TAB_H-40),
                    "健康檢測" if i == 0 else "推薦與服務", font(78),
                    "#0B424A" if on else "#C7ECE9")

    for idx, (cell, (_, icon)) in enumerate(zip(source["cells"], tab["cells"])):
        row, col = divmod(idx, COLS)
        x, y = COL_X[col]+28, ROW_Y[row]+24
        cw, ch = 1194, CELL_H-48
        caption, theme = DETAILS[icon]
        top, bottom, ink, muted, plate, icon_ink = PALETTES[theme]
        tile = gradient((cw, ch), top, bottom)
        td = ImageDraw.Draw(tile)
        # Low contrast contour rings add depth away from the text area.
        for radius in (245, 310, 375):
            td.ellipse((cw-110-radius, -80-radius, cw-110+radius, -80+radius), outline=plate, width=3)
        cx, cy, radius = cw//2, 215, 153
        td.ellipse((cx-radius-10, cy-radius+5, cx+radius+10, cy+radius+25), fill=plate)
        draw_icon(td, cx, cy, radius, icon, ink=icon_ink,
                  plate="#235F66" if theme == "deep" else "#FFFFFF")
        td.arc((cx-radius-20, cy-radius-20, cx+radius+20, cy+radius+20), 205, 310,
               fill=icon_ink, width=5)
        center_text(td, (40, 411, cw-80, 130), cell["label"],
                    fit_font(td, cell["label"], cw-100, 106), ink)
        center_text(td, (40, 548, cw-80, 88), caption, font(62), muted)
        mask = Image.new("L", tile.size)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, cw-1, ch-1), radius=48, fill=255)
        d.rounded_rectangle((x, y+7, x+cw-1, y+ch+6), radius=48, fill="#D8E2DE")
        img.paste(tile, (x, y), mask)
    return img


def main():
    OUT.mkdir(exist_ok=True)
    for tab in TABS:
        img = build(tab)
        path = OUT / f"richmenu-{tab['key']}.png"
        img.save(path, "PNG", optimize=True)
        kb = path.stat().st_size / 1024
        print(f"✔ {path.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}  {kb:.0f} KB")
        if kb > 1024:
            raise SystemExit("圖片超過 1MB，請先壓縮再上傳")


if __name__ == "__main__":
    main()

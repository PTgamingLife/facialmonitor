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
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "img"

W, H = 2500, 1686
TAB_H = 222
COLS, ROWS = 3, 2
CELL_H = 732
COL_X = [0, 833, 1666]
COL_W = [833, 833, 834]
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

FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"

TABS = [
    {
        "key": "health",
        "tab_labels": ["健康", "推薦"],
        "active": 0,
        "cells": [
            ("面舌診檢測", "scan"),
            ("我的報告",   "doc"),
            ("我的分數",   "chart"),
            ("每日打卡",   "check"),
            ("分享推薦",   "share"),
            ("問健康 AI",  "chat"),
        ],
    },
    {
        "key": "reward",
        "tab_labels": ["健康", "推薦"],
        "active": 1,
        "cells": [
            ("剩餘次數",   "ticket"),
            ("詢問顧問",   "doctor"),
            ("填寫小天使", "pen"),
            ("我推薦的人", "people"),
            ("購買次數",   "cart"),
            ("兌換 / 抽獎", "gift"),
        ],
    },
]


def font(size):
    return ImageFont.truetype(FONT_PATH, size)


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


def draw_icon(d, cx, cy, r, kind):
    """簡單的線條 icon。畫在半徑 r 的底圈中央,線寬固定。"""
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ICON_BG)
    c, lw = ICON_COL, 9
    s = r * 0.52   # icon 本體的半徑

    if kind == "scan":            # 掃描框 + 中央圓(面舌診)
        for dx, dy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
            x, y = cx + dx * s, cy + dy * s
            d.line([x, y, x - dx * s * 0.45, y], fill=c, width=lw)
            d.line([x, y, x, y - dy * s * 0.45], fill=c, width=lw)
        d.ellipse([cx - s * 0.34, cy - s * 0.34, cx + s * 0.34, cy + s * 0.34],
                  outline=c, width=lw)
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


def build(tab):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # ── 分頁列 ──
    tab_w = W // 2
    for i, label in enumerate(tab["tab_labels"]):
        x0 = tab_w * i
        x1 = W if i == 1 else tab_w
        on = (i == tab["active"])
        d.rectangle([x0, 0, x1, TAB_H], fill=TAB_ON if on else TAB_OFF)
        center_text(d, (x0, 0, x1 - x0, TAB_H), label, font(72),
                    WHITE if on else TEXT_DARK)
    # 選中分頁底部加一條白線,狀態更明顯
    ax0 = tab_w * tab["active"]
    d.rectangle([ax0, TAB_H - 10, ax0 + (W - ax0 if tab["active"] == 1 else tab_w), TAB_H],
                fill=WHITE)

    # ── 六格 ──
    # 版面配比:上 1/3 放小貼圖,下 2/3 放字。
    # 手機上圖文選單一格只有指甲大,字才是使用者真正在讀的東西,
    # icon 只要能認出是哪一類就夠,不需要跟字搶空間。
    ICON_R = 76
    for idx, (label, icon) in enumerate(tab["cells"]):
        r, c = divmod(idx, COLS)
        x, y, w = COL_X[c], ROW_Y[r], COL_W[c]

        # 格線(內側畫,不會蓋到相鄰格)
        if c > 0:
            d.rectangle([x, y, x + 3, y + CELL_H], fill=LINE_COL)
        if r > 0:
            d.rectangle([x, y, x + w, y + 3], fill=LINE_COL)

        # 上 1/3:小貼圖。整組(圖+字)在格子裡垂直置中,不要上擠下空。
        draw_icon(d, x + w / 2, y + CELL_H * 0.28, ICON_R, icon)
        # 下 2/3:標籤,字級自動縮到塞得下為止
        f_label = fit_font(d, label, w - 70, 112)
        center_text(d, (x, y + CELL_H * 0.50, w, CELL_H * 0.38), label, f_label, TEXT_DARK)

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
            print("  ⚠ 超過 LINE 的 1MB 上限,需要壓縮")


if __name__ == "__main__":
    main()

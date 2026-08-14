# 圖文選單底圖設計規格

要產出兩張圖:`img/richmenu-health.png`、`img/richmenu-reward.png`。

## 硬性規格(不符合 LINE 會直接拒收)

| 項目 | 要求 |
|---|---|
| 尺寸 | **2500 × 1686 px**(不能是別的尺寸) |
| 格式 | PNG 或 JPEG |
| 檔案大小 | **單張 1MB 以內** |
| 色彩 | RGB |

`scripts/line/setup-richmenu.mjs` 上傳前會印出檔案大小,超過 1MB 就先壓縮
(PNG 用 TinyPNG 之類的工具通常能砍掉一半以上,肉眼看不出差別)。

---

## ⚠️ 先讀這段:不要讓 AI 直接畫中文字

影像模型畫中文常常缺筆畫、字形變形、排版歪掉。**這張圖是每天出現在客戶手機
最下方的介面**,一個錯字會一直被看到,而且改一次要重跑整個選單建立流程。

建議兩段式:

1. **用 ChatGPT Image 2.0 只生背景** —— 配色、分頁列、六格分隔線、質感、
   六個 icon 的圖形。提示詞裡明講「不要有任何文字」。
2. **中文字自己疊上去** —— 把生成圖丟進 Canva 或 Figma,開 2500×1686 畫布,
   照下面的座標表放標籤。字體用 Noto Sans TC(與 App 一致)。

如果你還是想一次生成含字的版本,產出後請**逐格放大檢查每一個中文字**。

---

## 版位座標

畫布 2500 × 1686。分頁列 222px,下方 2 列 × 3 欄,每格 833 × 732。
(222 + 732 × 2 = 1686;833 + 833 + 834 = 2500)

| 區塊 | x | y | w | h |
|---|---|---|---|---|
| 分頁 1「健康」 | 0 | 0 | 1250 | 222 |
| 分頁 2「推薦」 | 1250 | 0 | 1250 | 222 |
| 格 1 | 0 | 222 | 833 | 732 |
| 格 2 | 833 | 222 | 833 | 732 |
| 格 3 | 1666 | 222 | 834 | 732 |
| 格 4 | 0 | 954 | 833 | 732 |
| 格 5 | 833 | 954 | 833 | 732 |
| 格 6 | 1666 | 954 | 834 | 732 |

**安全邊界:文字與 icon 距離格線至少 60px。** 手機上選單會被縮放,
太貼邊的東西容易被切掉或看起來擠。

每格建議排版:icon 在上(約 160px 見方,置中)、標籤在下(約 40–46px 字級)。

---

## 兩張圖的差別

**只有兩個地方不同**:分頁列哪一邊是選中狀態、六格的內容。
其餘(格線位置、底色、質感、字級)必須完全一致 ——
版型一致才會有「切換分頁時視覺零位移」的效果,這是這個設計的重點。

### `richmenu-health.png`
左分頁選中(實心主金 `#C49A5A`,白字)、右分頁未選(暖棕 `#C9A876`,深棕字)

| 格 | icon | 標籤 |
|---|---|---|
| 1 | 🔬 顯微鏡 / 臉部掃描線 | 面舌診檢測 |
| 2 | 📋 報告文件 | 我的報告 |
| 3 | 📈 上升折線 | 我的分數 |
| 4 | 🎟 票券 | 剩餘次數 |
| 5 | ✅ 打勾圓圈 | 今日任務 |
| 6 | 💬 對話框 | 問健康 AI |

### `richmenu-reward.png`
右分頁選中、左分頁未選

| 格 | icon | 標籤 |
|---|---|---|
| 1 | 🔗 連結環 | 綁定會員 |
| 2 | 👼 天使翅膀 | 我的小天使 |
| 3 | ✍️ 筆 | 填寫小天使 |
| 4 | 👥 兩個人 | 我推薦的人 |
| 5 | 🗓 日曆 | 14 天挑戰 |
| 6 | 🔄 循環箭頭 / 禮物 | 兌換抽獎 |

---

## 配色(取自 App 背景底圖 `bg.png`)

| 用途 | Hex |
|---|---|
| 底色 | `#F7F2EA` |
| 格線 / 次底色 | `#EDE5D6` |
| 未選中分頁 | `#C9A876` |
| 選中分頁 / 主色 | `#C49A5A` |
| icon 底圈 | `#F0E4CC` |
| 標題字 | `#2E2418` |
| 說明字 | `#6B5840` |
| 點綴(可選) | `#4A6B3F` 植物綠 |

---

## ChatGPT Image 2.0 提示詞

ChatGPT 產圖不會直接給你 2500×1686。做法是:**先請它生 3:2 的圖(1536×1024),
再進 Canva 開 2500×1686 畫布把圖鋪滿,然後疊中文字**。

### 提示詞 A —— 健康分頁背景

```
A clean mobile app menu background, 3:2 landscape, flat vector style, no text
of any kind, no letters, no characters.

Layout: a horizontal bar across the top taking about 13% of the height, split
into two equal halves. The LEFT half is a solid warm gold color (#C49A5A). The
RIGHT half is a lighter muted tan (#C9A876). Below that bar, the remaining area
is divided into a 2-row by 3-column grid of six equal rectangular cells,
separated by thin 2px lines in soft beige (#EDE5D6).

Background of all six cells: warm cream (#F7F2EA), with a very subtle paper
texture.

Inside each cell, centered in the upper portion, place one simple line icon
drawn in warm gold (#C49A5A) sitting on a soft pale-gold circle (#F0E4CC).
The six icons, in reading order: a microscope, a clipboard document, a rising
line chart, a ticket stub, a checkmark in a circle, a speech bubble.

Leave generous empty space in the lower third of each cell (text will be added
later). Minimal, calm, spa-like, premium wellness brand aesthetic. Soft warm
lighting. No text, no words, no numbers, no watermark.
```

### 提示詞 B —— 推薦分頁背景

同上,**只改兩處**:

- 分頁列改成:`The LEFT half is a lighter muted tan (#C9A876). The RIGHT half
  is a solid warm gold color (#C49A5A).`
- 六個 icon 改成:`a chain link, a pair of angel wings, a pen writing, two
  person silhouettes, a calendar, a circular arrow with a small gift box`

**其餘文字一字不改** —— 這是兩張圖版型一致的關鍵。

### 產圖後的檢查

- 上方分頁列高度是不是約佔 13%?(對應 222/1686)偏差太多就在 Canva 手動調整。
- 六格是不是等寬等高、格線筆直?
- 有沒有偷偷跑出文字或浮水印?有的話重生成,或在 Canva 蓋掉。

---

## 完成後

把兩張圖放進 `img/`,檔名必須是
`richmenu-health.png` 與 `richmenu-reward.png`(腳本讀 `scripts/line/richmenu-config.json`
裡的 `image` 欄位,要改檔名就改那裡),然後執行:

```bash
LINE_CHANNEL_ACCESS_TOKEN=xxx \
APP_BASE_URL=https://ptgaminglife.github.io/facialmonitor \
  node scripts/line/setup-richmenu.mjs
```

先加 `--dry-run` 看一次座標沒問題再正式跑。
腳本可以重複執行,圖改了就重跑一次,不會殘留舊選單。

# LINE 圖文選單與資訊卡視覺更新

## 設計

- 沿用「看·健」深海青，新增霧藍、薄荷綠、暖米色分區。
- 兩分頁仍為 2500 × 1686、頂部分頁列 222px、四格各 1250 × 732px；所有 LIFF、postback、alias 及點擊座標不變。
- 大圖示、清楚的主標題及一行功能說明；圓角、淺陰影與低對比輪廓線提供背景層次。
- `infoCard` 改為深青漸層標題、淡青底、白色數值及資料區。採用 LINE 原生 Flex 元件，無新增圖片下載依賴。
- 保留 hero、altText、文字內容、按鈕 action、扣點二次確認及 carousel 上限。長分數與說明可換行。
- 主要按鈕與小字加深顏色，避免亮青底白字或過淡提示文字。

## 重製與檢查

需要 Python、Pillow，以及 Noto Sans CJK TC Bold 或 Windows 微軟正黑體 Bold：

```sh
python -X utf8 scripts/line/make-richmenu-images.py
node scripts/line/setup-richmenu.mjs --dry-run
```

圖片名稱維持原路徑：

- `img/richmenu-health.png`
- `img/richmenu-reward.png`

本次輸出約 168 KB / 159 KB。產圖時會核對設定檔幾何並檢查 1MB 檔案門檻；中文標籤取自設定檔。

已在本機比對五種卡片（分數、任務、推薦、僅標題、圖片與長文）的原有文字、actions、hero 與 altText；另比對確認卡 actions 與 carousel 上限。Node 24 可載入共用 TypeScript 模組；測試以空白環境 stub 隔離 Deno，不讀憑證、不發送訊息。

HTML 預覽只近似 Flex 的呈現；已檢視桌面與手機寬度，並非 LINE 真機或官方 API 驗證。合併前仍建議用 LINE Flex Simulator 和測試帳號確認長文、圖片、不同字級及多按鈕卡片。

## 上線

本次僅準備獨立分支，不部署、不發送訊息。

合併 main 會依既有 workflow 部署靜態網站與 Edge Functions；圖文選單須另外手動執行「🍱 重建圖文選單」。既有重建腳本會先刪舊選單，可能短暫空白，請安排適當時間。不可只更新 PNG 就視為 LINE 選單已上線。

參考：LINE 官方 [Flex 漸層背景](https://developers.line.biz/en/docs/messaging-api/flex-message-layout/#linear-gradient-backgrounds)。

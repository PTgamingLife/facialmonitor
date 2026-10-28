# More Minesweeper（LIFF 版）

單檔靜態網頁：`index.html`（HTML + CSS + JS，無建置步驟、無後端）。

## 部署到 LIFF
1. 把 `index.html` 放到任何 HTTPS 靜態主機（GitHub Pages / Netlify / Vercel / Cloudflare Pages）。
2. LINE Developers → LIFF → 新增 App：
   - Endpoint URL：上一步的網址
   - Size：Full
   - Scope：`profile`
3. 把取得的 LIFF ID 填入 `index.html` 內：
   `const MS_LIFF_ID = '';` → `const MS_LIFF_ID = '你的LIFF ID';`
4. 重新部署。LIFF ID 留空也能玩，只是不顯示 LINE 名稱。

## 外部依賴（CDN）
- 字體：Google Fonts `Silkscreen`
- LINE LIFF SDK：`https://static.line-scdn.net/liff/edge/2/sdk.js`

## 規格
- 5 模式：Tutorial 5x5/3、Easy 7x7/6、Medium 10x10/15、Hard 14x14/35、Challenge 16x20/60（限時 5 分）
- 操作：點擊翻開、長按插旗（或開 FLAG 模式）、點已翻開數字格自動翻周圍（chording）、按住顯示鄰格
- 圖示:像素 SVG 內嵌(炸彈黑 #1b1a1d、旗紅 #e04848)
- 首擊必安全；最佳時間存 localStorage（key：`ms_best_<mode>`）
- 配色：底 #5f5c63、格 #a9a7ac、格線 #e9e8ea、已翻開 #7d7a81

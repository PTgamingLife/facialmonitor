# 貓咪躲紙箱(cat-box)— LINE LIFF 小遊戲封包

拔插銷益智遊戲,10 關。純靜態網頁(HTML/CSS/JS),不需 build,丟到任何靜態主機即可。
程式代號 `cb`,所有參數/資料表/函式都以 `cb_` 開頭。

## 檔案
| 檔案 | 用途 |
|---|---|
| `index.html` | 入口(LIFF Endpoint 指到這裡) |
| `css/cb-style.css` | 樣式(配色:糖果夢幻) |
| `js/cb-config.js` | **部署設定:LIFF ID、Supabase URL/Key** |
| `js/cb-engine.js` | 物理/規則引擎(水、岩漿、石頭、角色) |
| `js/cb-levels.js` | 10 關關卡資料 |
| `js/cb-draw.js` | Canvas 繪圖(場景、粒子、特效;圖片載入失敗時用向量角色備援) |
| `js/cb-sprites.js` | 角色圖片 + 程式動作(呼吸、走路、落地壓扁、跳進紙箱、狗被打飛) |
| `assets/cb_*.webp` | Higgsfield 生成圖:貓/狗/紙箱 + 姿勢圖(貓走路×2、跳、躲進箱;狗跑、暈倒)、背景、磚牆、Logo,共約 216KB |
| `js/cb-net.js` | LIFF 登入/分享、排行榜 API |
| `js/cb-app.js` | 畫面切換、進度、遊戲迴圈 |
| `sql/cb_scores.sql` | 排行榜資料表 + RPC(**尚未套用**) |

## 交接 ① 部署 / LIFF agent
1. 把整個資料夾部署到 HTTPS 靜態主機(GitHub Pages / Netlify / Vercel 皆可)。
2. LINE Developers → LINE Login channel → 新增 LIFF app:
   - Endpoint URL:`https://<你的網域>/<路徑>/index.html`
   - Size:**Full**
   - Scopes:`profile`、`openid`
   - 開啟 **shareTargetPicker**(分享給好友用)
3. 把拿到的 LIFF ID 填進 `js/cb-config.js` 的 `cb_liffId`,重新部署。
4. 驗收:在 LINE 開 `https://liff.line.me/<LIFF ID>` → 首頁顯示 LINE 名稱與頭像。

> `cb_liffId` 空白時 = 訪客模式:可玩,進度只存本機,不上排行榜。

## 交接 ② Supabase agent(排行榜)
1. 在 Supabase 專案執行 `sql/cb_scores.sql`(建立 `cb_scores` 表、`cb_submit_score`、`cb_get_top10`)。
2. 表開 RLS 且無 policy,前端只能經由兩個 RPC 存取;`cb_get_top10` 不回傳 user_id。
3. `js/cb-config.js` 已填好 Supabase URL 與 publishable key,若換專案請一併修改。
4. 驗收:LINE 內過一關 → 排行榜出現自己。

**已知風險**:成績由前端直接上傳,技術上可偽造。若要防作弊,改成 Edge Function
先用 LINE `https://api.line.me/oauth2/v2.1/verify` 驗證 ID token,再寫入 `cb_scores`。

## 遊戲規則(給測試人員)
- 點金色插銷拔出;貓碰到紙箱 = 過關
- 岩漿:燙傷貓、燒掉紙箱、消滅狗;水 + 岩漿 → 石頭;石頭從高處掉落可砸暈狗
- 狗看到貓(中間無牆/插銷)會衝過來
- 星數:一次過 ★★★、第二次 ★★、之後 ★;排行榜依 星數 → 過關數 → 總時間 排序

## 各關正解(插銷編號 = `cb-levels.js` 中 pins 陣列索引)
| 關 | 正解 | 關 | 正解 |
|---|---|---|---|
| 1 | 0 | 6 | 0 → 3 → 1 |
| 2 | 1 | 7 | 2 → 1 → 0 |
| 3 | 1 → 2 → 0 | 8 | 2 → 3 → 0 → 1 → 4 |
| 4 | 0 → 1 → 2 | 9 | 2 → 1 → 0 → 3 |
| 5 | 0 → 1 → 2 → 3 | 10 | 2 → 0 → 1 |

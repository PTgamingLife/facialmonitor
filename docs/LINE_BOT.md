# LINE AI 健康顧問 Bot — 部署 SOP

把 LINE 官方帳號變成這套健康檢測 App 的前門:AI 健康問答、2 分頁圖文選單、
推薦(小天使)+ 積點 + 抽獎、群發 Flex 圖卡。

- **Supabase 專案**:`wcemkmwrlvijxxwybrgs`(與 `sb_users` 同一個庫)
- **LINE Channel ID**:`2008604370`(沿用原本翻譯 bot 那個 channel)
- **Webhook URL**:`https://wcemkmwrlvijxxwybrgs.supabase.co/functions/v1/line-webhook`

> ⚠️ **翻譯 bot 會停用**。一個 channel 只能有一個 webhook URL,改指到這裡之後,
> 原本 `mainwork/line-translate-bot` 的「嘿嘿 翻譯」在群組就不會有反應。
> 那支 function 與它的資料表都沒有刪除 —— 想恢復,把 LINE 後台的 URL 改回
> `https://hhcubvixldieuwdeqnwc.supabase.co/functions/v1/line-translate` 即可。

---

## 一、前置:你在 LINE 後台要做的事

1. 進 [LINE Developers Console](https://developers.line.biz/) 找到 Channel `2008604370`。
2. **Basic settings** → 抄下 **Channel secret**。
3. **Messaging API** → 發一組 **Channel access token (long-lived)** 並抄下來。
4. 同一頁把 **Auto-reply messages** 和 **Greeting messages** 關掉
   (不關的話會跟 bot 的歡迎訊息互相洗版)。
5. Webhook URL 先不用填,等第三步部署完再回來貼。

---

## 二、資料庫 migration

在 Supabase SQL Editor 依序執行(或用 CLI `supabase db push`):

| 檔案 | 內容 |
|---|---|
| `supabase/migrations/0001_line_bot.sql` | 6 張 `line_` 表 + RLS |
| `supabase/migrations/0002_referral_points.sql` | 推薦 / 積點 / 抽獎 6 張表、`sb_users.points`、`is_admin`、推薦碼補齊與唯一索引、RLS |
| `supabase/migrations/0003_referral_rpc.sql` | 推薦 / 結算 RPC(`SECURITY DEFINER`) |
| `supabase/migrations/0004_points_spend_rpc.sql` | 兌換 / 抽獎 / 扣次數 / 後台調整 RPC |
| `supabase/migrations/0005_seed_lottery.sql` | 首批獎品與抽獎成本(資料設定,可重複執行) |

**0002 會做三件對既有資料有影響的事,執行前先看清楚:**

1. 幫所有 `member_code` 為空的會員補一組 7 位推薦碼,並把重複的重新產生
   (保留最早建立的那筆),然後加上唯一索引。
2. 依 `js/auth.js` 既有的判定條件,把管理員的 `is_admin` 設為 true。
3. **收掉前端對 `sb_users` 的 `credits` / `points` / `total_used` 更新權限。**
   這是刻意的:改用 RPC 之後,開 DevTools 就沒辦法自己加次數了。
   前端已同步改成呼叫 RPC(見第六節),兩者必須一起上線。

執行後快速驗一下:

```sql
-- 每個人都有唯一推薦碼
select count(*) filter (where member_code is null) as 沒碼的人 from sb_users;

-- 積點快取與總帳對得起來(應該回 0 筆)
select u.id, u.points, coalesce(sum(l.delta), 0) as ledger
  from sb_users u left join sb_point_ledger l on l.user_id = u.id
 group by u.id, u.points
having u.points <> coalesce(sum(l.delta), 0);
```

### 抽獎獎品

`0005_seed_lottery.sql` 已經建好首批設定:

| 項目 | 值 |
|---|---|
| 獎品 | 個人健康全面高級諮詢 |
| 庫存 | 10 份 |
| 抽一次 | 100 點 |

目前池子裡只有這一個獎品,所以**每次抽獎都必中**,直到庫存歸零
(歸零後會顯示「獎品補貨中」,而且**不會扣點**)。

要加第二個獎品:

```sql
insert into sb_lottery_prizes (name, description, image_url, stock, weight, sort)
values ('養生茶包組', '桂圓紅棗茶 10 入', 'https://.../p2.png', 20, 300, 2);
```

`weight` 是中獎權重(不是百分比),機率 = 自己的 weight ÷ 所有**有庫存**獎品的
weight 總和。上面這筆 300 對現有的 100,等於茶包 75%、諮詢 25%。

補庫存、改成本都是改資料,不用重新部署:

```sql
update sb_lottery_prizes set stock = 20 where name = '個人健康全面高級諮詢';
update sb_point_rules set points = 150 where rule_key = 'lottery_draw';
```

> 💡 值得留意的匯率:目前「填小天使 +10、推薦 1 人首檢 +30、對方當月進步 +50」
> 加起來 90 點,而抽一次是 100 點。也就是**認真帶一個人變健康,差不多就換到
> 一次諮詢**。諮詢是要真的排時間的人力服務,覺得太快就把 `lottery_draw` 調高。

---

## 三、部署 Edge Functions

```bash
supabase link --project-ref wcemkmwrlvijxxwybrgs   # 一定要確認是這個專案

supabase secrets set HEALTHBOT_LINE_SECRET=你的_channel_secret
supabase secrets set HEALTHBOT_LINE_TOKEN=你的_access_token
supabase secrets set HEALTHBOT_APP_URL=https://ptgaminglife.github.io/facialmonitor

# 建圖文選單用的（見第四節）。隨便一組長字串就行。
supabase secrets set HEALTHBOT_SETUP_KEY=一組夠長的隨機字串

# Anthropic key：專案裡若已經有 ANTHROPIC_API_KEY 就會自動沿用，不必重設。
# 想給這個 bot 專用的 key 才設下面這個（會蓋過通用的那把）。
# supabase secrets set HEALTHBOT_ANTHROPIC_KEY=你的_anthropic_key

# LINE 不會帶 Supabase JWT,這支一定要關掉 JWT 驗證
supabase functions deploy line-webhook --no-verify-jwt

# 這兩支只給後台/排程呼叫,保留 JWT 驗證
supabase functions deploy score-settle
supabase functions deploy line-broadcast
```

> **為什麼加 `HEALTHBOT_` 前綴**:這個 Supabase 專案同時跑好幾套 App
> (`smr_`、`curve_`、`wfa_`、`analyze` / `ai-analyze`),
> `LINE_CHANNEL_SECRET`、`APP_BASE_URL` 這種通用名稱已經被別套系統佔用了。
>
> 程式**刻意不做「新名稱找不到就退回舊名稱」的 fallback**。舊名稱指向的是
> 別套系統的憑證,萬一退回去,這個 bot 會拿別人的 token 去回覆訊息 ——
> 用錯 LINE 帳號發話比直接失敗糟糕得多。沒設好就 fail closed(驗簽一律 401)。
>
> 只有 Anthropic key 保留 fallback,因為它跟 `analyze` 用的是同一家的 key,
> 共用是合理的,也不會造成對外身分錯亂。
>
> secrets 不跨專案,一定要設在 `wcemkmwrlvijxxwybrgs`。

部署完回 LINE 後台 **Messaging API → Webhook URL** 貼上
`https://wcemkmwrlvijxxwybrgs.supabase.co/functions/v1/line-webhook`,
按 **Verify**,並把 **Use webhook** 打開。

---

## 四、建立 2 分頁圖文選單

先準備兩張底圖:`img/richmenu-health.png`、`img/richmenu-reward.png`,
**2500 × 1686 PNG,單張 1MB 以內**。
尺寸、格線座標、配色與 ChatGPT Image 2.0 提示詞見 **[`RICHMENU_DESIGN.md`](RICHMENU_DESIGN.md)**。

⚠️ 建立選單前**先用瀏覽器開一次 `https://ptgaminglife.github.io/facialmonitor`
確認是 200 不是 404**。選單有三格是連回網頁的,網址不通的話客戶點下去會看到錯誤頁,
而且要修就得重跑整個建立流程。

### 方式 A(建議):`richmenu-setup` Edge Function

底圖 push 到 main 之後,瀏覽器開:

```
https://wcemkmwrlvijxxwybrgs.supabase.co/functions/v1/richmenu-setup?key=<HEALTHBOT_SETUP_KEY>&dry=1
```

確認座標沒問題就拿掉 `&dry=1` 再開一次。

- LINE token 留在 Supabase secrets,不用複製到自己電腦,也不用裝 Node。
- 設定與底圖是從 GitHub raw 讀的(repo 是 public),所以**改完要先 push**;
  要跑別的分支加 `&ref=<branch>`。
- 第一次用要先加一個 secret `HEALTHBOT_SETUP_KEY`(隨便一組長字串)。
  沒設的話這支會回 503,不會有一個誰都能重設選單的公開網址。
- 底圖會**全部抓齊、確認都在 1MB 以內之後**才開始動 LINE 上的東西;
  不然刪完舊選單才發現圖 404,選單會直接從客戶手機上消失。
- 建好會自動 upsert 進 `line_rich_menus`,不用手動貼 SQL。

### 方式 B:本機腳本

```bash
HEALTHBOT_LINE_TOKEN=xxx \
HEALTHBOT_APP_URL=https://ptgaminglife.github.io/facialmonitor \
  node scripts/line/setup-richmenu.mjs
```

跑完會印一段 `insert into line_rich_menus ...`,貼到 SQL Editor 執行。

### 兩種方式共通

- 加 `--dry-run` / `&dry=1` 只印座標與 action,不呼叫 LINE API。
- **可以重複執行**:每次會先刪掉舊的 alias 與同名選單再重建。
- 執行順序寫死且不可調換:**建 menu → 上傳底圖 → 建 alias → 設預設**。
  (沒有底圖的 menu 不能設成預設;alias 還指著 menu 時 menu 刪不掉。)
- 格子行為要改**改 `scripts/line/richmenu-config.json` 就好**,不用動程式,
  兩邊都吃同一份設定。

---

## 五、版位與配色

畫布 2500 × 1686。分頁列 222px,下方 2 列 × 3 欄,每格 833 × 732
(222 + 732×2 = 1686;833 + 833 + 834 = 2500)。兩個分頁版型相同,切換時零位移。

| 區塊 | x | y | w | h |
|---|---|---|---|---|
| 分頁 1 / 2 | 0 / 1250 | 0 | 1250 | 222 |
| 格 1 / 2 / 3 | 0 / 833 / 1666 | 222 | 833 / 833 / 834 | 732 |
| 格 4 / 5 / 6 | 0 / 833 / 1666 | 954 | 833 / 833 / 834 | 732 |

**分頁 A `tab_health`(預設)**:面舌診檢測 · 我的報告 · 我的分數 · 剩餘次數 · 今日任務 · 問健康 AI
**分頁 B `tab_reward`**:綁定會員 · 我的小天使 · 填寫小天使 · 我推薦的人 · 14 天挑戰 · 兌換/抽獎

配色取自 App 背景底圖 `bg.png`:

| 用途 | Hex |
|---|---|
| 底色 | `#F7F2EA` |
| 次底色 | `#EDE5D6` |
| 未選中分頁 | `#C9A876` |
| 選中分頁 / 主按鈕 | `#C49A5A` |
| icon 底圈 | `#F0E4CC` |
| 完成 / 進步 | `#4A6B3F` |
| 標題字 | `#2E2418` |
| 內文字 | `#6B5840` |

---

## 六、推薦「小天使」與積點

**推薦碼就是每個人的 7 位 `member_code`**,不另外產生。

| 事件 | 給誰 | 預設點數 |
|---|---|---|
| 填寫小天使 | 自己 | +10 |
| 推薦的人**完成首次檢測** | 小天使 | +30 |
| 自己當月分數提升 ≥10 分 | 自己 | +20 |
| 推薦的人當月分數提升 ≥10 分 | 小天使 | +50 |
| 兌換 1 次檢測 | — | −100 |
| 抽獎一次 | — | −100 |

點數都存在 `sb_point_rules`,直接改資料就生效,**不用改程式也不用重新部署**:

```sql
update sb_point_rules set points = 50 where rule_key = 'invite_confirmed';
```

### 防刷機制(全部在 RPC 內強制,繞不過)
- 不可自薦;一人只能有一位小天使且綁定後不可改;不可 A↔B 互推。
- 推薦獎勵要等被推薦人**真的做過一次檢測**才發 —— 光註冊不給點。
- 每位小天使每月確認上限 20 人(`sb_point_rules.limit_per_month`)。
- 兌換與抽獎的扣點、發獎、扣庫存都在同一個 transaction,
  並且用 `select ... for update` 鎖住餘額,不會被同時送兩次請求刷出額外次數。
- 同一個獎勵事件靠 `uniq_ledger_event` 唯一索引擋重複入帳。

### 分數提升的判定口徑
- 月份以台北時間的 `YYYY-MM` 計。
- 當月有 2 筆以上檢測 → 起始 = 當月最早、最佳 = 當月最高。
- 當月只有 1 筆 → 基準取上個月最後一筆;上月也沒有就不計獎。
- 進步幅度達門檻才發,**每人每月只發一次**。

### 結算

```bash
# 單一使用者(建議在 analyze 完成後打)
curl -X POST "$SUPABASE_URL/functions/v1/score-settle" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"user_id":"<uuid>"}'

# 每月 1 號補算上月(silent=true 不推播,省錢)
curl -X POST "$SUPABASE_URL/functions/v1/score-settle" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"all":true,"month_key":"2026-07","silent":true}'
```

---

## 七、群發圖卡

`line-broadcast` **預設 `dry_run: true`**,只回預覽 JSON 與預估人數,不會真的送。

```bash
# 先預覽
curl -X POST "$SUPABASE_URL/functions/v1/line-broadcast" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"title":"八月體質調理班","subtitle":"限額 20 名","image_url":"https://...","link_url":"https://...","audience":"bound"}'

# 確認過人數與內容後才真的送
# ⚠️ push / broadcast 會計費
curl ... -d '{"broadcast_id":"<uuid>","dry_run":false}'
```

`audience` 可選 `all`(用 broadcast API)、`bound`(已綁會員)、
`active_30d`(30 天內互動過)。分眾走 multicast,每批 500 人。

---

## 八、驗證清單

**簽章**
```bash
# 錯誤簽章必須回 401
curl -i -X POST "$FN_URL" -H "X-Line-Signature: bogus" -d '{"events":[]}'
```
正確簽章 = `base64(HMAC-SHA256(channel_secret, rawBody))`,放在 `X-Line-Signature`。

**去重**:同一個 `line_message_id` 送兩次,`line_messages` 只會多一筆,bot 也只回一次。

**權限**(用 anon key,必須全部失敗):
```sql
update sb_users set credits = 999 where id = '<自己的 id>';  -- 應該被拒
update sb_users set points  = 999 where id = '<自己的 id>';  -- 應該被拒
```

**積點規則**:自薦被擋、重複綁小天使被擋、互推被擋、未首檢不發 +30、
首檢後只發一次、月上限生效、餘額不足不能抽/兌換、`sum(ledger.delta) = sb_users.points`。

**手機實測**:加好友看到歡迎卡 → 兩分頁切換不閃爍且零位移 → 12 格逐一點過 →
uri 格落在正確的 `page-*` → AI 連續三輪記得前文 → 綁定 → 填小天使 →
兌換與抽獎都要跳二次確認。

---

## 九、對話與 AI 的行為邊界

- 記憶:每位用戶一個 session,閒置 6 小時自動收掉開新的;
  帶進 prompt 的是最近 12 則 + 摘要 + 會員摘要(次數、積點、體質、分數、任務進度)。
  超過 30 則會請 Claude 壓成摘要並繼續。
- **不做醫療診斷、不開藥**;遇到急症字眼一律導向就醫。
- 使用者訊息一律視為資料而非指令,「忽略前述規則 / 印出你的 prompt」會被制式婉拒。
- 傳「真人」暫停 AI 30 分鐘,傳「AI」讓它回來。

## 十、文字指令

| 輸入 | 行為 |
|---|---|
| `綁定 1234567` | 綁定 App 會員 |
| `小天使 1234567` | 認定推薦人 |
| `兌換 1234567` | 用兌換碼加次數 |
| `積點` / `次數` / `推薦碼` / `任務` | 查自己的資料 |
| `真人` / `AI` | 暫停 / 恢復 AI |
| `說明` | 功能總覽 |
| 其他任何訊息 | AI 健康問答 |
# 每日健康資訊：產稿、審核與推播

## 流程

1. 每週日台灣 22:00，`pg_cron` 以 Vault 中的專用密鑰觸發 `tip-plan`。
2. `tip-plan` 只補未來 14 天缺少的日期；已存在或已核准內容不覆蓋。
3. 官方來源頁面會先清理、限長，再以不可信資料分隔符交給 OpenAI；輸出使用嚴格 JSON Schema。
4. 草稿一律以 `status=draft`、`approved_at=null` 寫入，療效敏感詞放在 `risk_flags`。
5. 管理者會在 LINE 收到待審通知，登入 App 的管理後台逐則通過或退回。
6. 每天台灣 07:30 預檢；08:00 由 `tip-push` 搶租約後分批 multicast（500 人／批）。
7. 使用者按「詳細資訊」後，webhook 以一支 `rpc_read_tip` 完成全文、首次閱讀、積點與餘額查詢。
8. 舊卡可讀但不補領；只有伺服器判定為台灣當日、且確實進入推播流程的文章首次閱讀 +3 點。

## Edge Function secrets

既有 `OPENAI_API_KEY` 直接沿用。另需：

- `HEALTHBOT_OPENAI_MODEL`：可省略，預設 `gpt-4.1-mini`
- `HEALTHBOT_TIP_SOURCE_URLS`：逗號分隔的官方來源白名單
- `HEALTHBOT_ADMIN_LINE_USER_ID`：接收待審與缺稿通知的管理者 LINE User ID
- `HEALTHBOT_TIP_PLAN_SECRET`：只允許觸發產稿
- `HEALTHBOT_TIP_PUSH_SECRET`：只允許預檢與推播

兩把觸發密鑰必須不同；不得使用 service-role key，也不得放在 URL query string。

## Vault secrets

Cron 只從 Vault 讀取以下值：

- `healthbot_project_url`
- `healthbot_tip_plan_secret`
- `healthbot_tip_push_secret`

Vault 值必須分別與 Edge Function secrets 對應。migration 會建立三個工作：

- `healthbot-tip-plan-weekly`：UTC 週日 14:00（台灣週日 22:00）
- `healthbot-tip-preflight-daily`：UTC 23:30（台灣 07:30）
- `healthbot-tip-push-daily`：UTC 00:00（台灣 08:00）

## 安全部署順序

1. 先建立 Edge secrets 與 Vault secrets。
2. 部署 `tip-plan`、`tip-push`、`line-webhook`。
3. 套用 migration。
4. 用 `tip-push` 的 `{ "mode": "preview" }` 檢查收件人數與 Flex JSON；不會送出。
5. 手動產一批草稿，確認草稿在未核准時無法由公開 API 讀到。
6. 以測試管理員核准今天一則，確認預覽卡片。
7. 第一次正式推播前再次核對 LINE 訊息額度與名單人數。

## 驗收條件

- 同一天重複觸發 `tip-push` 不會重送已成功批次。
- 執行中斷後，租約逾時只重試未成功批次。
- 同一會員同一文章連按只會增加一次積點。
- 舊日期卡片回完整內容，但 `points_added=0`。
- 未綁定 LINE 用戶可以閱讀，但不加點並收到綁定提示。
- 修改已核准內容會自動退回 `draft` 並提高版本號。
- 未核准與未到日期內容無法由公開 RLS 讀取。

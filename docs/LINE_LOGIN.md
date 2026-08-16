# 用 LINE 登入(取代 Google)

網頁的登入從 Google 換成 LINE。目的是把「LINE 帳號」與「網頁會員」變成同一個東西 ——
從圖文選單點進來就已經是登入狀態,不用再輸入會員碼綁定。

舊的 Google 帳號資料不會消失,改成在「診斷紀錄」頁用一顆按鈕一次搬過來。

---

## ⚠️ 上線順序不能顛倒

`index.html` 是 GitHub Pages 的來源,**合併到 main 就等於上線**。
在下面第 1~4 步做完之前先不要合併 —— `window.LIFF_ID` 還是空字串,
按登入只會看到「LINE 登入尚未設定完成」,等於所有人都進不去。

正確順序:**建 channel → 填 LIFF_ID → 設 secrets → 本機確認 → 才合併**。

---

## 1. 建立 LINE Login channel 與 LIFF app

在 [LINE Developers Console](https://developers.line.biz/console/):

1. 找到**現在這個 Messaging API channel 所屬的 Provider**,在同一個 Provider 底下
   新增一個 **LINE Login** channel。
2. 進去該 channel → **LIFF** 分頁 → **Add**:

   | 欄位 | 值 |
   |---|---|
   | LIFF app name | 看健 |
   | Size | Full |
   | Endpoint URL | `https://ptgaminglife.github.io/facialmonitor/index.html` |
   | Scopes | `profile`、`openid` |
   | Bot link feature | On(Aggressive) |

3. 記下兩個值:**LIFF ID**(像 `2008604370-abcd1234`)與該 channel 的
   **Channel ID**(純數字)。

> ### 🚨 Provider 一定要同一個
> LINE 的 `userId` 是**以 Provider 為單位**發放的。
> LINE Login channel 若建在別的 Provider 底下,LIFF 拿到的 `U...` 與 webhook
> 收到的 `U...` 會是兩組不同的值 —— 帳號永遠對不起來,而且症狀是
> 「每一步看起來都成功,就是查不到人」,極難查。
> 建立前先確認 Provider 名稱與 Messaging API channel 相同。

---

## 2. 填 LIFF ID

`js/config.js`:

```js
window.LIFF_ID = '2008604370-abcd1234';   // 換成你的
```

## 3. 設 Supabase secrets

在 `wcemkmwrlvijxxwybrgs` 專案:

```
HEALTHBOT_LIFF_CHANNEL_ID = <LINE Login channel 的 Channel ID>
HEALTHBOT_APP_ORIGIN      = https://ptgaminglife.github.io
```

`HEALTHBOT_APP_ORIGIN` 是 CORS 白名單,只有這個來源能呼叫 `liff-auth`。
兩個都沒設的話 `liff-auth` 一律回 503(fail closed),不會退回「相信前端」。

## 4. 更新圖文選單

`scripts/line/richmenu-config.json` 填上同一組 LIFF ID:

```json
{ "liffId": "2008604370-abcd1234", ... }
```

填了之後,`uri` 的三格會改指向 `https://liff.line.me/<liffId>?p=page-xxx`,
在 LINE 裡點下去就是已登入狀態。留空則維持舊行為(直接開網頁,要自己登入)。

改完重跑一次建立選單即可(見 `LINE_BOT.md` 第四節)。

---

## 登入是怎麼運作的

```
LIFF 開啟網頁 → liff.getIDToken()
   → POST /functions/v1/liff-auth  { id_token }
   → 後端拿 token 去 api.line.me/oauth2/v2.1/verify 驗證
   → 找 / 建 sb_users（記下 line_user_id）
   → 順手補 line_users.sb_user_id，讓 bot 立刻認得這個人
   → 回一個一次性 token_hash
   → 前端 supabase.auth.verifyOtp() 換成正式 session
```

**身分一定由後端向 LINE 驗證。** 前端送上來的 `userId` 一律不採信 ——
若採信,任何人改一行 JS 就能宣稱自己是別人,直接接管帳號與積點。

在 LINE 外面開(桌機、把連結分享出去)也能用:會走正式的 LINE Login 轉址,
只是多一次授權畫面。

---

## 舊 Google 帳號資料轉移

「診斷紀錄」頁上的「用 Google 登入並轉移」按鈕。流程:

```
1. 現在是 LINE 帳號 → rpc_issue_merge_ticket() 開一張 15 分鐘有效的票
2. 票存到 localStorage → 跳去 Google 登入
3. 回來時 session 是舊帳號 → rpc_redeem_merge_ticket(票)
4. 登出 Google → 自動換回 LINE 帳號
```

**為什麼要用票券**:轉移一定會換 session,兩個身分不可能同時在線。
如果讓瀏覽器自己說「請搬到帳號 X」,任何人都能把資料塞進別人的帳號。
改成「新帳號在自己還登入時先開票,票裡才寫得了目標」,舊帳號只能拿票兌換,
目標無法偽造。

### 會搬什麼

| 項目 | 規則 |
|---|---|
| 檢測紀錄 | 全部 |
| 積點帳本 | 搬每一筆,不是搬總額(歷史留得住);`points` 依帳本重算 |
| 剩餘次數 / 健康幣 | 相加 |
| 連續天數 | 取較大的 |
| 月度分數快照 | 同月份已有就保留新帳號的 |
| 我推薦的人 | 全部跟著搬 |
| 我的小天使 | 新帳號還沒填才搬 |
| 會員碼 | **用舊的** —— 舊碼可能已經給過朋友,新帳號的碼幾乎不可能流出去 |
| 管理員身分 | 跟著搬(少了這條,管理員換 LINE 登入之後會拿不到後台) |

搬完舊帳號會被封存(`merged_into` 有值),`credits` 與 `points` 歸零 ——
兩者都是花得掉的餘額,留著就會變成一筆對不上帳的幽靈點數。

> **管理員請注意**:你第一次用 LINE 登入時是一個全新帳號,**看不到後台**。
> 做完轉移才會拿回管理員身分。這是預期行為,不是壞掉。

---

## 一併移除的東西

- **漂流瓶**:整個功能從 UI、JS、CSS 移除,成就列表也拿掉對應項目。
  資料表 `sb_bottles` 沒有動(刪資料是不可逆的,要清請另外決定)。
- **Google 登入按鈕**:登入頁只剩 LINE。Google 只在轉移流程裡出現一次。
- **「請用 Safari 開啟」橫幅**:不再對 LINE 顯示 —— 改用 LIFF 之後,
  LINE 內建瀏覽器反而是主場。

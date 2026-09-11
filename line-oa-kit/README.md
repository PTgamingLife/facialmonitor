# FACIALMONITOR LINE OA Kit

一頁式 LINE Official Account 規劃與教學產生器。使用者可選擇 4／6／8 格圖文選單、每格反應、固定回覆、AI 知識、語氣與語音模式，再下載可交給 Codex 或 Claude Code 的建置封包。

線上版本：<https://facialmonitor-line-kit.ptchen321.chatgpt.site/>

## 功能

- 4、6、8 格 LINE OA 介面設定
- 訊息、半頁 LIFF、全頁 LIFF、外部網頁行為
- 固定回覆與 AI 回覆設定
- AI 知識、語氣文字與文件上傳
- 從零開始的 GitHub、Supabase、LINE OA、API Key、Secrets 教學
- 互動式 LINE OA 手機預覽
- 安全封包與高敏感封包模式

## 本機執行

```bash
npm install
npm run dev
```

依終端顯示的本機網址開啟瀏覽器。

正式建置：

```bash
npm run build
```

## 安全

預設安全封包不包含 Token 或 Secret。請勿把 `.env.local`、LINE Channel Secret、LINE Channel Access Token、AI API Key 或 Supabase Personal Access Token 提交到 GitHub。

## 授權

MIT

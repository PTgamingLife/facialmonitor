/* ══════════════════════════════════════════════════════════════════
   分享推薦 —— 邀請訊息只有這一份

   同一則邀請原本有三份實作(auth.js、reward.js、line-webhook 的
   handlers.ts),而且已經漂移過兩次:一次是「看·健 / 大數據健康檢測」
   兩套說法,一次是 auth.js 掉了開頭那句鉤子。網頁這兩份收在這裡,
   之後改文案只有一個地方要動。

   (bot 那一份還在 handlers.ts —— 它跑在 Deno 上,載不到這支。
    兩邊的文字必須一致,改一邊記得改另一邊。)

   ── 為什麼是 Flex 而不是純文字 ──────────────────────────────
   純文字送出去,LINE 會自己去爬網址、在下面貼一張它生成的預覽卡。
   那張卡長什麼樣不是我們能決定的,而且沒有按鈕 —— 朋友得自己
   認出那串 liff.line.me 網址是可以點的。

   Flex 則是我們自己排版的卡片,最下面是一顆「免費體驗看看」按鈕。
   代價:只有 liff.shareTargetPicker() 送得出 Flex,而它
   ① 只在 LINE 內建瀏覽器裡有 ② 要在 LINE Developers 後台把該支
   LIFF app 的 shareTargetPicker 打開。兩個條件任一不成立就退回
   複製文字 —— 不會變成一顆按不動的按鈕。

   altText 直接用原本那段文字。通知列、舊版 LINE、複製出去貼到別處
   看到的都是它,所以它不能只是「你收到一張卡片」這種敷衍的字。
   ══════════════════════════════════════════════════════════════════ */

const BRAND_DEEP = '#0D5C63';   // 深墨綠
const BRAND_MINT = '#22C1C3';   // 健康青

/** 專屬推薦網址:對方登入後會自動把推薦人綁定成小天使。 */
function inviteUrl(code) {
  return `https://liff.line.me/${window.LIFF_ID}?p=page-main&ref=${encodeURIComponent(code)}`;
}

/**
 * 邀請文字。與 handlers.ts 的 inviteText() 逐字相同。
 * 開頭那句是鉤子:先讓對方想到自己,再講產品。
 */
function inviteText(code) {
  return `如果我可以更快知道自己的身體狀況⋯⋯\n\n`
    + `我在用「看·健」測體質、做健康任務，滿有感的 🌿\n\n`
    + `點我的專屬網址加入，登入後會自動綁定推薦人，並獲得 1 次免費檢測：\n`
    + `${inviteUrl(code)}\n\n`
    + `推薦碼：${code}（備用）`;
}

/**
 * 邀請卡片。
 *
 * 刻意不放 hero 圖:標題已經把「臉和舌頭」講完了,再配一張寫著同一件事
 * 的圖只是變吵 —— 跟群發主視覺不放圖示是同一個理由。
 */
function inviteFlex(code, name) {
  const who = name ? `${name} 推薦你一起試試` : '朋友推薦你一起試試';

  return {
    type: 'flex',
    altText: inviteText(code),
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: BRAND_DEEP,
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '如果我可以更快知道',   color: '#FFFFFF',  size: 'lg', weight: 'bold', wrap: true },
          { type: 'text', text: '自己的身體狀況⋯⋯',     color: BRAND_MINT, size: 'lg', weight: 'bold', wrap: true },
          { type: 'text', text: who, color: '#B9DDDF', size: 'sm', margin: 'md', wrap: true },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md',
        contents: [
          {
            type: 'text', wrap: true, size: 'sm', color: '#333333',
            text: '用一張臉部與舌頭的照片，看懂目前的健康狀態，並獲得適合自己的 14 天健康方向。',
          },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'vertical', margin: 'lg', spacing: 'xs',
            contents: [
              { type: 'text', text: '推薦碼', size: 'xs', color: '#999999' },
              {
                type: 'text', text: String(code), size: 'xxl', weight: 'bold',
                color: BRAND_DEEP,
              },
              {
                type: 'text', wrap: true, size: 'xs', color: '#666666', margin: 'md',
                text: '點下面的按鈕加入，登入後會自動綁定推薦人，並獲得 1 次免費檢測。',
              },
            ],
          },
          {
            type: 'text', wrap: true, size: 'xxs', color: '#AAAAAA', margin: 'lg',
            text: '本服務提供中醫養生與體質參考，不是醫療診斷，也不能取代醫師。',
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [{
          type: 'button', style: 'primary', height: 'sm', color: BRAND_DEEP,
          action: { type: 'uri', label: '免費體驗看看', uri: inviteUrl(code) },
        }],
      },
    },
  };
}

/** 首頁「複製分享訊息」:只複製,不叫好友選擇器。 */
function shareRefCode(code) {
  const text = inviteText(code);
  if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
  navigator.clipboard?.writeText(text)
    .then(() => showToast('✅ 分享訊息已複製'))
    .catch(() => showToast('複製失敗，請手動選取'));
}

/** 叫出 LINE 的好友選擇器，把邀請卡片直接送到對方的聊天室。 */
async function startShareFlow() {
  if (!await initLiff()) { showToast('請在 LINE 裡開啟才能分享'); return; }

  const code = currentUser?.member_code;
  if (!code) { showToast('會員碼還沒載入，請稍後再試'); return; }

  if (typeof liff === 'undefined' || !liff.isApiAvailable?.('shareTargetPicker')) {
    fallbackShare(code);
    return;
  }

  try {
    const res = await liff.shareTargetPicker([inviteFlex(code, currentUser?.name)]);
    // res 為 null = 使用者按了取消，不要當成失敗吼他
    showToast(res ? '✅ 已送出，朋友收到就能用你的推薦碼' : '已取消分享');
  } catch (e) {
    console.error('shareTargetPicker failed', e);
    fallbackShare(code);
  }
}

/**
 * 選擇器用不了時的退路。
 *
 * 在 LINE 裡就走原生的分享 scheme —— 它只能帶純文字(所以才不是預設),
 * 但一定開得起來,而且結果跟這次改版之前一模一樣。這比複製到剪貼簿好:
 * 使用者按的是「分享」,期待的是跳出好友清單,不是一句「已複製」。
 *
 * 會走到這裡通常只有一個原因:LINE Developers 後台沒把這支 LIFF app 的
 * shareTargetPicker 打開。那是設定問題,不該讓使用者連分享都分享不出去。
 */
function fallbackShare(code) {
  const text = inviteText(code);
  if (typeof liff !== 'undefined' && liff.isInClient?.()) {
    location.href = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
    return;
  }
  copyText(text);
  showToast('已複製分享文字，貼給朋友就可以了');
}

/**
 * 管理員發送中心的前端。
 *
 * 這一頁不是門 —— 每一次動作都帶 LIFF 的 ID token 給 admin-api,
 * 由後端向 LINE 查證身分再比對擁有者。前端的隱藏與顯示只是體驗。
 *
 * 刻意不做的事:不在前端組 Flex JSON。預覽只是「夠接近的樣子」,
 * 真正的長相以「發送本人測試卡片」為準 —— 卡片怎麼組只有後端那一份,
 * 前端再寫一份就會出現「預覽好看、送出去不一樣」。
 */

const ADMIN_LIFF_ID = '';   // 建好 LIFF app(Full)之後填這裡
const API = 'https://wcemkmwrlvijxxwybrgs.supabase.co/functions/v1/admin-api';

const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value.trim();

let idToken = '';

function say(text, cls) {
  const m = $('msg');
  m.textContent = text;
  m.className = 'msg ' + (cls || '');
}

async function api(action, extra) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id_token: idToken, ...(extra || {}) }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/* ── 草稿 ───────────────────────────────────────────── */

function draft() {
  const when = val('f-when');
  return {
    title: val('f-title'),
    subtitle: val('f-subtitle'),
    note: val('f-note'),
    link_label: val('f-link-label'),
    link_url: val('f-link-url'),
    image_url: val('f-image-url'),
    image_layout: val('f-image-layout'),
    audience: val('f-audience'),
    ask_ai: $('f-ask-ai').checked,
    // datetime-local 沒有時區,使用者輸入的是自己手機的在地時間。
    // 直接交給 Date 解析,送出去是 ISO —— 後端只認 ISO。
    scheduled_at: when === 'later' && val('f-at') ? new Date(val('f-at')).toISOString() : '',
  };
}

const TEMPLATES = {
  blank: { title: '', subtitle: '', note: '', link_label: '', link_url: '' },
  game: {
    title: '小遊戲時間到了 🎮',
    subtitle: '貓咪躲紙箱、極光下樓梯、踩地雷，三個隨你挑。',
    note: '不用登入、不花點數。等人、排隊、睡不著的時候玩。',
    link_label: '我來試試',
    link_url: 'https://ptgaminglife.github.io/facialmonitor/games/index.html',
  },
};

function apply(t) {
  const d = TEMPLATES[t];
  $('f-title').value = d.title;
  $('f-subtitle').value = d.subtitle;
  $('f-note').value = d.note;
  $('f-link-label').value = d.link_label;
  $('f-link-url').value = d.link_url;
  counts();
  renderPreview();
}

/* ── 預覽 ───────────────────────────────────────────── */

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderPreview() {
  const d = draft();
  if (!d.title) { $('pv').innerHTML = '<div class="hint">填了標題才看得到預覽。</div>'; return; }
  const topImg = d.image_url && d.image_layout === 'hero';
  const sepImg = d.image_url && d.image_layout === 'message';
  $('pv').innerHTML = `
    ${sepImg ? `<img class="pv-img" src="${esc(d.image_url)}" alt="">` : ''}
    <div class="pv">
      ${topImg ? `<img class="pv-img" src="${esc(d.image_url)}" alt="">` : ''}
      <div class="pv-head">
        <div class="brand">看·健 / 健康顧問</div><b>${esc(d.title)}</b>
      </div>
      <div class="pv-body">
        ${d.subtitle ? `<div class="s">${esc(d.subtitle)}</div>` : ''}
        ${d.note ? `<div class="n">${esc(d.note)}</div>` : ''}
      </div>
      ${d.link_url ? `<div class="pv-foot"><div class="pv-btn">${esc(d.link_label || '立即報名')}</div></div>` : ''}
    </div>`;
}

function counts() {
  for (const [id, max] of [['title', 60], ['subtitle', 1000]]) {
    const n = $('f-' + id).value.trim().length;
    const el = $('c-' + id);
    el.textContent = `${n} / ${max}`;
    el.className = 'count' + (n > max ? ' over' : '');
  }
}

/* ── 後端往返 ───────────────────────────────────────── */

async function refresh() {
  const [ov, ls] = await Promise.all([api('overview'), api('broadcast_list')]);
  if (ov.body.ok) {
    const a = ov.body.audience;
    $('stats').innerHTML = [
      [a.all, '全部好友'], [a.bound, '已綁定'], [a.active_30d, '近 30 天活躍'],
    ].map(([n, t]) => `<div class="stat"><b>${n}</b><span>${t}</span></div>`).join('');
    const nd = ov.body.next_free_push_day;
    $('next-day').textContent = nd
      ? `下一個還沒有內容的推播日：${nd}　待發排程 ${ov.body.pending_scheduled} 則`
      : `未來 60 天的推播日都已經有內容了。待發排程 ${ov.body.pending_scheduled} 則`;
  }
  if (ls.body.ok) {
    const rows = ls.body.items || [];
    $('list').innerHTML = rows.length ? rows.map((r) => {
      const when = r.sent_at || r.scheduled_at || r.created_at;
      const cls = r.status === 'sent' ? 'sent' : r.status === 'failed' ? 'failed' : '';
      const label = r.status === 'sent' ? `已送出 ${r.sent_count} 人`
        : r.scheduled_at ? '待發' : '草稿';
      return `<div class="item"><b>${esc(r.title)}<span class="pill ${cls}">${label}</span></b>
              <span>${esc(String(when).replace('T', ' ').slice(0, 16))}</span></div>`;
    }).join('') : '<div class="hint">還沒有任何卡片。</div>';
  }
}

async function preview() {
  renderPreview();
  const r = await api('broadcast_preview', { draft: draft() });
  $('pv-count').textContent = r.body.ok
    ? `預計送達 ${r.body.estimated_recipients} 人`
    : (r.body.error || '');
}

/* ── 啟動 ───────────────────────────────────────────── */

function showGate(text, lineUserId) {
  $('app').hidden = true;
  $('gate').hidden = false;
  $('gate-text').textContent = text;
  $('gate-id').value = lineUserId || '';
  say('');
}

async function boot() {
  if (!ADMIN_LIFF_ID) {
    say('這一頁還沒接上 LIFF app（ADMIN_LIFF_ID 是空的）。', 'err');
    return;
  }
  try {
    await liff.init({ liffId: ADMIN_LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
    idToken = liff.getIDToken() || '';
    if (!idToken) {
      say('拿不到 LINE 身分 —— 這個 LIFF app 要勾選 openid 權限。', 'err');
      return;
    }

    const me = await api('whoami');
    if (!me.body.ok) { say(me.body.error || '驗證失敗。', 'err'); return; }
    const who = me.body.who;
    if (!who.is_owner) {
      showGate(
        who.owner_configured
          ? '這個帳號不是已綁定的擁有者。如果應該是你，請確認下面這串與 Secret 裡設定的一致。'
          : '還沒設定擁有者，所以後台對所有人關著。照下面的步驟綁定一次就好。',
        who.line_user_id);
      return;
    }

    $('app').hidden = false;
    say('');
    await refresh();
    await preview();
  } catch (e) {
    console.error(e);
    say(e.message || '初始化失敗，請關閉重開。', 'err');
  }
}

/* ── 綁事件 ─────────────────────────────────────────── */

['f-title', 'f-subtitle', 'f-note', 'f-link-label', 'f-link-url', 'f-image-url']
  .forEach((id) => $(id).addEventListener('input', () => { counts(); renderPreview(); }));
['f-image-layout', 'f-audience'].forEach((id) => $(id).addEventListener('change', preview));
$('f-ask-ai').addEventListener('change', renderPreview);
$('f-when').addEventListener('change', () => { $('when-later').hidden = val('f-when') !== 'later'; });
$('t-blank').addEventListener('click', () => apply('blank'));
$('t-game').addEventListener('click', () => apply('game'));

$('gate-copy').addEventListener('click', () => {
  navigator.clipboard?.writeText($('gate-id').value)
    .then(() => say('✅ 已複製', 'ok'))
    .catch(() => say('複製失敗，請手動選取。', 'err'));
});

$('b-test').addEventListener('click', async () => {
  $('b-test').disabled = true;
  const r = await api('broadcast_test', { draft: draft() });
  say(r.body.ok ? '✅ 測試卡片已送到你的 LINE，去看看實際長相。'
                : (r.body.error || '送不出去。'), r.body.ok ? 'ok' : 'err');
  $('b-test').disabled = false;
});

$('b-send').addEventListener('click', async () => {
  const d = draft();
  if (!d.title) { say('標題不能空白。', 'err'); return; }

  if (val('f-when') === 'later') {
    if (!d.scheduled_at) { say('選一個送出時間。', 'err'); return; }
    $('b-send').disabled = true;
    const r = await api('broadcast_schedule', { draft: d });
    say(r.body.ok ? '✅ 已排程。每天台北 09:00 那次 cron 會撿到期的那一則。'
                  : (r.body.error || '排程失敗。'), r.body.ok ? 'ok' : 'err');
    $('b-send').disabled = false;
    await refresh();
    return;
  }

  const pv = await api('broadcast_preview', { draft: d });
  const n = pv.body.ok ? pv.body.estimated_recipients : '?';
  // 最後一道關。群發會計費,而且收不回來。
  if (!confirm(`現在就送給 ${n} 個人，收不回來。確定嗎？\n\n${d.title}`)) return;

  $('b-send').disabled = true;
  say('送出中…');
  const r = await api('broadcast_send', { draft: d, confirm: true });
  say(r.body.ok ? `✅ 已送出，${r.body.sent} 人。` : (r.body.error || '送出失敗。'),
      r.body.ok ? 'ok' : 'err');
  $('b-send').disabled = false;
  await refresh();
});

boot();

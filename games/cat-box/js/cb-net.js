// cb-net.js — LINE LIFF 登入/分享 + Supabase 排行榜
(function (cb_root) {
  const C = cb_root.CB_CONFIG;
  const cb_user = { cb_id: '', cb_name: '訪客', cb_avatar: '', cb_isLine: false };

  async function cbInitLiff() {
    if (!C.cb_liffId || !cb_root.liff) return cbGuest();
    try {
      await liff.init({ liffId: C.cb_liffId });
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return cb_user; }
      const p = await liff.getProfile();
      Object.assign(cb_user, { cb_id: p.userId, cb_name: p.displayName || '玩家', cb_avatar: p.pictureUrl || '', cb_isLine: true });
    } catch (err) {
      console.warn('[cb] LIFF init 失敗,改用訪客模式', err);
      cbGuest();
    }
    return cb_user;
  }

  function cbGuest() {
    let id = '';
    try { id = localStorage.getItem('cb_guest_id') || ''; } catch (e) { /* 無痕模式 */ }
    if (!id) {
      id = 'guest_' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem('cb_guest_id', id); } catch (e) { /* 無痕模式 */ }
    }
    cb_user.cb_id = id;
    return cb_user;
  }

  async function cbRpc(fn, body) {
    const res = await fetch(`${C.cb_supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: C.cb_supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(`${fn} ${res.status}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  async function cbSubmitScore(cb_totals) {
    if (!cb_user.cb_isLine) return false;   // 只有 LINE 登入的玩家上榜
    try {
      await cbRpc('cb_submit_score', {
        p_user_id: cb_user.cb_id, p_name: cb_user.cb_name, p_avatar: cb_user.cb_avatar,
        p_stars: cb_totals.cb_stars, p_cleared: cb_totals.cb_cleared, p_time_ms: cb_totals.cb_timeMs,
      });
      return true;
    } catch (err) { console.warn('[cb] 上傳成績失敗', err); return false; }
  }

  async function cbFetchTop10() {
    return cbRpc('cb_get_top10');
  }

  async function cbShare(cb_text) {
    const url = C.cb_liffId ? `https://liff.line.me/${C.cb_liffId}` : location.href;
    const msg = `${cb_text}\n一起來玩 👉 ${url}`;
    try {
      if (cb_root.liff && C.cb_liffId && liff.isApiAvailable && liff.isApiAvailable('shareTargetPicker')) {
        const r = await liff.shareTargetPicker([{ type: 'text', text: msg }]);
        return r ? 'sent' : 'cancel';
      }
      if (navigator.share) { await navigator.share({ title: C.cb_gameName, text: msg }); return 'sent'; }
      await navigator.clipboard.writeText(msg);
      return 'copied';
    } catch (err) { console.warn('[cb] 分享失敗', err); return 'fail'; }
  }

  cb_root.CB_NET = { cb_user, cbInitLiff, cbSubmitScore, cbFetchTop10, cbShare };
})(window);

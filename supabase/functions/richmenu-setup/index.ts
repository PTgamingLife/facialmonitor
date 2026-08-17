// 圖文選單建立器(一次性管理工具,跑在 Supabase 上)
//
// 為什麼做成 Edge Function 而不是只有本機腳本:
//   LINE token 已經在 Supabase secrets 裡了,本機腳本讀不到,等於要再把 token
//   複製一份到自己電腦上 —— token 每多存在一個地方就多一個外洩點。
//   跑在這裡則是「token 從頭到尾沒離開 Supabase」,而且不用裝 Node。
//   本機腳本 scripts/line/setup-richmenu.mjs 保留,兩支邏輯相同。
//
// 部署:
//   supabase functions deploy richmenu-setup --no-verify-jwt
//
// 呼叫(瀏覽器直接開就行):
//   https://wcemkmwrlvijxxwybrgs.supabase.co/functions/v1/richmenu-setup?key=<HEALTHBOT_SETUP_KEY>
//   加 &dry=1 只印出要送的座標,不動 LINE 上的任何東西
//   加 &ref=<branch> 讀別的分支的設定與底圖(預設 main)
//
// 需要的 secrets:
//   HEALTHBOT_LINE_TOKEN  已有
//   HEALTHBOT_APP_URL     已有
//   HEALTHBOT_SETUP_KEY   要新增。隨便一組長字串,只是不想讓這支被路人打
//
// 設定與底圖都從 GitHub raw 讀(repo 是 public),所以改完 config 或換圖
// 只要 push 再打一次這個網址,不用重新部署。

import { upsert } from "../_shared/db.ts";

const TOKEN = Deno.env.get("HEALTHBOT_LINE_TOKEN") ?? "";
const APP_BASE_URL = (Deno.env.get("HEALTHBOT_APP_URL") ?? "").replace(/\/$/, "");
const SETUP_KEY = Deno.env.get("HEALTHBOT_SETUP_KEY") ?? "";

const API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";
const RAW = "https://raw.githubusercontent.com/PTgamingLife/facialmonitor";

interface Cell {
  label: string;
  type: "uri" | "postback" | "message";
  target?: string;
  action?: string;
  text?: string;
}
interface Tab {
  key: string;
  alias: string;
  name: string;
  chatBarText: string;
  image: string;
  default?: boolean;
  cells: Cell[];
}
interface Config {
  liffId?: string;
  canvas: { width: number; height: number };
  layout: { tabBarHeight: number; rows: number; cols: number; cellHeight: number };
  tabs: Tab[];
}

async function line(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body instanceof Uint8Array
      ? (body as unknown as BodyInit)   // Uint8Array 是合法 body,只是 lib.dom 的型別沒涵蓋
      : body
      ? JSON.stringify(body)
      : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

/** 依 layout 算出所有可點區塊,與 scripts/line/setup-richmenu.mjs 同一套算法 */
function buildAreas(config: Config, tab: Tab) {
  const { width } = config.canvas;
  const { tabBarHeight, rows, cols, cellHeight } = config.layout;
  const areas: unknown[] = [];

  // 分頁列:等寬切,最後一格補足餘數
  const tabWidth = Math.floor(width / config.tabs.length);
  config.tabs.forEach((t, i) => {
    const w = i === config.tabs.length - 1 ? width - tabWidth * i : tabWidth;
    areas.push({
      bounds: { x: tabWidth * i, y: 0, width: w, height: tabBarHeight },
      // 自己那頁也指向自己:點了不動作、不閃爍、不打 webhook
      action: { type: "richmenuswitch", richMenuAliasId: t.alias, data: `tab=${t.key}` },
    });
  });

  const cellWidth = Math.floor(width / cols);
  tab.cells.forEach((cell, idx) => {
    if (idx >= rows * cols) return;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const w = c === cols - 1 ? width - cellWidth * c : cellWidth;
    const y = tabBarHeight + cellHeight * r;

    let action: unknown;
    if (cell.type === "uri") {
      // 有 liffId 就走 LIFF:在 LINE 裡開會自動帶身分,使用者不用再登入一次。
      // LIFF 只保證帶過去 query string,不保證帶 hash,所以頁面用 ?p= 指定。
      if (config.liffId) {
        action = { type: "uri", label: cell.label,
                   uri: `https://liff.line.me/${config.liffId}?p=${cell.target}` };
      } else {
        if (!APP_BASE_URL) throw new Error("這份設定有 uri 格子,但沒有設 HEALTHBOT_APP_URL 或 liffId");
        action = { type: "uri", label: cell.label, uri: `${APP_BASE_URL}/index.html#${cell.target}` };
      }
    } else if (cell.type === "message") {
      action = { type: "message", label: cell.label, text: cell.text };
    } else {
      action = {
        type: "postback",
        label: cell.label,
        data: `action=${cell.action}&tab=${tab.key}`,
        displayText: cell.label,
      };
    }
    areas.push({ bounds: { x: cellWidth * c, y, width: w, height: cellHeight }, action });
  });

  return areas;
}

function assertLayout(config: Config) {
  const { width, height } = config.canvas;
  const { tabBarHeight, rows, cellHeight } = config.layout;
  const total = tabBarHeight + rows * cellHeight;
  if (total !== height) {
    throw new Error(`版型高度對不上:${tabBarHeight} + ${rows}x${cellHeight} = ${total},畫布是 ${height}`);
  }
  if (width !== 2500 || height !== 1686) {
    throw new Error(`畫布必須是 2500x1686,目前是 ${width}x${height}`);
  }
}

async function fetchRaw(ref: string, path: string): Promise<Response> {
  // raw.githubusercontent 會限流(429)。同一天多跑幾次選單就會撞到,
  // 而且訊息只有一個數字,看起來像檔案不見了。退避重試幾次再放棄。
  let last = 0;
  for (const waitMs of [0, 1500, 4000, 9000]) {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    const res = await fetch(`${RAW}/${ref}/${path}`);
    if (res.ok) return res;
    last = res.status;
    if (res.status !== 429 && res.status < 500) break;   // 404 之類重試也沒用
  }
  throw new Error(
    last === 429
      ? `GitHub 暫時限流(429),等一兩分鐘再打一次同一個網址就好`
      : `讀不到 ${path}(ref=${ref}):${last}`,
  );
}

async function run(ref: string, dry: boolean, log: string[]) {
  const config: Config = await (await fetchRaw(ref, "scripts/line/richmenu-config.json")).json();
  assertLayout(config);
  log.push(`設定來源:${ref} / scripts/line/richmenu-config.json`);
  // 印出來,才看得出線上這版有沒有吃到 liffId ——
  // 這次就是 config 加了 liffId 但函式沒重新部署,結果 uri 還是舊網址,
  // 而輸出裡完全看不出原因。
  log.push(`liffId:${config.liffId || "(未設定,uri 格子直接開網頁)"}`);

  if (dry) {
    for (const tab of config.tabs) {
      log.push(`\n=== ${tab.name}(${tab.alias})===`);
      log.push(JSON.stringify(buildAreas(config, tab), null, 2));
    }
    log.push("\n(dry run,沒有呼叫 LINE API)");
    return;
  }

  // ① 先把底圖抓下來。全部抓齊才動 LINE 上的東西 ——
  //    不然刪完舊選單才發現圖 404,選單就直接消失在客戶手機上了
  const images = new Map<string, Uint8Array>();
  for (const tab of config.tabs) {
    const buf = new Uint8Array(await (await fetchRaw(ref, tab.image)).arrayBuffer());
    if (buf.length > 1024 * 1024) throw new Error(`${tab.image} 有 ${(buf.length / 1024).toFixed(0)} KB,超過 LINE 的 1MB 上限`);
    images.set(tab.key, buf);
    log.push(`底圖 ${tab.image} ${(buf.length / 1024).toFixed(0)} KB OK`);
  }

  // ② 清掉舊的(alias 還指著 menu 時 menu 刪不掉,順序不能反)
  for (const t of config.tabs) {
    try {
      await line("DELETE", `${API}/richmenu/alias/${t.alias}`);
      log.push(`舊 alias ${t.alias} 已刪除`);
    } catch { /* 本來就沒有 */ }
  }
  const { richmenus = [] } = await line("GET", `${API}/richmenu/list`);
  const names = new Set(config.tabs.map((t) => t.name));
  for (const m of richmenus as { richMenuId: string; name: string }[]) {
    if (names.has(m.name)) {
      await line("DELETE", `${API}/richmenu/${m.richMenuId}`);
      log.push(`舊選單 ${m.name} 已刪除`);
    }
  }

  // ③ 建選單 → ④ 上傳圖 → ⑤ 建 alias(順序有相依,不可調換)
  const created: (Tab & { richMenuId: string })[] = [];
  for (const tab of config.tabs) {
    const { richMenuId } = await line("POST", `${API}/richmenu`, {
      size: config.canvas,
      selected: !!tab.default,
      name: tab.name,
      chatBarText: tab.chatBarText,
      areas: buildAreas(config, tab),
    });
    created.push({ ...tab, richMenuId });
    log.push(`建立 ${tab.name} -> ${richMenuId}`);
  }

  for (const tab of created) {
    const type = /\.jpe?g$/.test(tab.image) ? "image/jpeg" : "image/png";
    const buf = images.get(tab.key);
    if (!buf) throw new Error(`${tab.key} 的底圖不見了`);
    await line("POST", `${DATA_API}/richmenu/${tab.richMenuId}/content`, buf, {
      "Content-Type": type,
    });
    log.push(`上傳 ${tab.image}`);
  }

  for (const tab of created) {
    await line("POST", `${API}/richmenu/alias`, {
      richMenuAliasId: tab.alias,
      richMenuId: tab.richMenuId,
    });
    log.push(`alias ${tab.alias} -> ${tab.richMenuId}`);
  }

  // ⑥ 設預設
  const def = created.find((t) => t.default) ?? created[0];
  await line("POST", `${API}/user/all/richmenu/${def.richMenuId}`);
  log.push(`預設選單 = ${def.name}`);

  // ⑦ 記進 DB,之後查得到現在線上是哪一組
  for (const tab of created) {
    await upsert("line_rich_menus", {
      tab_key: tab.key,
      richmenu_id: tab.richMenuId,
      alias_id: tab.alias,
      image_file: tab.image,
      is_default: !!tab.default,
    }, { onConflict: "tab_key" });
  }
  log.push("line_rich_menus 已更新");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? req.headers.get("x-setup-key") ?? "";

  // 沒設 key 就整支關掉,不要留一個誰都能重設選單的網址
  if (!SETUP_KEY) {
    return new Response("HEALTHBOT_SETUP_KEY 沒設,這支功能暫停服務", { status: 503 });
  }
  if (key !== SETUP_KEY) {
    return new Response("forbidden", { status: 403 });
  }
  if (!TOKEN) {
    return new Response("HEALTHBOT_LINE_TOKEN 沒設", { status: 503 });
  }

  const log: string[] = [];
  try {
    await run(url.searchParams.get("ref") ?? "main", url.searchParams.get("dry") === "1", log);
    log.push("\n完成");
    return new Response(log.join("\n"), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    log.push(`\n失敗:${e instanceof Error ? e.message : String(e)}`);
    console.error("richmenu-setup failed:", e);
    return new Response(log.join("\n"), {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
});

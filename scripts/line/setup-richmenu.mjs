#!/usr/bin/env node
/**
 * 建立 2 分頁圖文選單(一支跑完)
 *
 * 用法(在 repo 根目錄):
 *   HEALTHBOT_LINE_TOKEN=xxx HEALTHBOT_APP_URL=https://ptgaminglife.github.io/facialmonitor \
 *     node scripts/line/setup-richmenu.mjs
 *
 * 加 --dry-run 只印出要送的 payload,不呼叫 LINE API。
 *
 * 建立順序有相依性,不可調換:
 *   1. 建 rich menu  → 拿 richMenuId
 *   2. 上傳底圖      → 沒有圖的 menu 不能設為預設
 *   3. 建 alias      → richmenuswitch 靠 alias 找目標
 *   4. 設預設選單
 * 重跑時會先刪掉舊的 alias 與 menu,所以可以安全重複執行。
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const TOKEN = process.env.HEALTHBOT_LINE_TOKEN ?? "";
const APP_BASE_URL = (process.env.HEALTHBOT_APP_URL ?? "").replace(/\/$/, "");
const DRY_RUN = process.argv.includes("--dry-run");

const API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

/** 依 config 的 layout 算出所有可點區塊的座標 */
function buildAreas(config, tab) {
  const { width, height } = config.canvas;
  const { tabBarHeight, rows, cols, cellHeight } = config.layout;
  const tabs = config.tabs;

  const areas = [];

  // 分頁列:等寬切,最後一格補足餘數
  const tabWidth = Math.floor(width / tabs.length);
  tabs.forEach((t, i) => {
    const w = i === tabs.length - 1 ? width - tabWidth * i : tabWidth;
    areas.push({
      bounds: { x: tabWidth * i, y: 0, width: w, height: tabBarHeight },
      // 自己那頁也指向自己:點了不動作、不閃爍、不打 webhook
      action: { type: "richmenuswitch", richMenuAliasId: t.alias, data: `tab=${t.key}` },
    });
  });

  // 內容格
  const cellWidth = Math.floor(width / cols);
  tab.cells.forEach((cell, idx) => {
    if (idx >= rows * cols) return;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const w = c === cols - 1 ? width - cellWidth * c : cellWidth;
    const y = tabBarHeight + cellHeight * r;

    let action;
    if (cell.type === "uri") {
      if (!APP_BASE_URL) die("這份設定有 uri 格子,必須提供 HEALTHBOT_APP_URL");
      action = { type: "uri", label: cell.label, uri: `${APP_BASE_URL}/index.html#${cell.target}` };
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

function assertLayout(config) {
  const { width, height } = config.canvas;
  const { tabBarHeight, rows, cellHeight } = config.layout;
  const total = tabBarHeight + rows * cellHeight;
  if (total !== height) {
    die(`版型高度對不上:${tabBarHeight} + ${rows}×${cellHeight} = ${total},但畫布是 ${height}`);
  }
  if (width !== 2500 || height !== 1686) {
    console.warn(`⚠ 畫布不是 2500×1686(目前 ${width}×${height}),LINE 只接受特定尺寸`);
  }
}

async function cleanup(config) {
  // 先刪 alias,再刪 menu(alias 還指著 menu 時刪不掉)
  for (const t of config.tabs) {
    try {
      await api("DELETE", `${API}/richmenu/alias/${t.alias}`);
      console.log(`  · 舊 alias ${t.alias} 已刪除`);
    } catch { /* 本來就沒有,略過 */ }
  }

  const { richmenus = [] } = await api("GET", `${API}/richmenu/list`);
  const names = new Set(config.tabs.map((t) => t.name));
  for (const m of richmenus) {
    if (names.has(m.name)) {
      await api("DELETE", `${API}/richmenu/${m.richMenuId}`);
      console.log(`  · 舊選單 ${m.name} 已刪除`);
    }
  }
}

async function main() {
  const config = JSON.parse(await readFile(path.join(HERE, "richmenu-config.json"), "utf8"));
  assertLayout(config);

  if (DRY_RUN) {
    for (const tab of config.tabs) {
      console.log(`\n=== ${tab.name}(${tab.alias})===`);
      console.log(JSON.stringify(buildAreas(config, tab), null, 2));
    }
    console.log("\n(dry-run,沒有呼叫 LINE API)");
    return;
  }

  if (!TOKEN) die("缺少 HEALTHBOT_LINE_TOKEN");

  console.log("① 清掉舊的 alias 與選單(讓這支腳本可以重複執行)");
  await cleanup(config);

  const created = [];

  console.log("② 建立選單");
  for (const tab of config.tabs) {
    const { richMenuId } = await api("POST", `${API}/richmenu`, {
      size: config.canvas,
      selected: !!tab.default,
      name: tab.name,
      chatBarText: tab.chatBarText,
      areas: buildAreas(config, tab),
    });
    created.push({ ...tab, richMenuId });
    console.log(`  · ${tab.name} → ${richMenuId}`);
  }

  console.log("③ 上傳底圖");
  for (const tab of created) {
    const imgPath = path.join(ROOT, tab.image);
    let buf;
    try {
      buf = await readFile(imgPath);
    } catch {
      die(`找不到底圖 ${tab.image}(預期位置:${imgPath})`);
    }
    const type = tab.image.endsWith(".jpg") || tab.image.endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";
    await api("POST", `${DATA_API}/richmenu/${tab.richMenuId}/content`, new Uint8Array(buf), {
      "Content-Type": type,
    });
    console.log(`  · ${tab.image} 已上傳(${(buf.length / 1024).toFixed(0)} KB)`);
  }

  console.log("④ 建立 alias");
  for (const tab of created) {
    await api("POST", `${API}/richmenu/alias`, {
      richMenuAliasId: tab.alias,
      richMenuId: tab.richMenuId,
    });
    console.log(`  · ${tab.alias} → ${tab.richMenuId}`);
  }

  console.log("⑤ 設定預設選單");
  const def = created.find((t) => t.default) ?? created[0];
  await api("POST", `${API}/user/all/richmenu/${def.richMenuId}`);
  console.log(`  · 預設 = ${def.name}`);

  console.log("\n✔ 完成。把下面這段記到 line_rich_menus(或用 supabase SQL Editor 執行):\n");
  const values = created
    .map((t) =>
      `  ('${t.key}', '${t.richMenuId}', '${t.alias}', '${t.image}', ${!!t.default})`
    )
    .join(",\n");
  console.log(
    `insert into line_rich_menus (tab_key, richmenu_id, alias_id, image_file, is_default)\nvalues\n${values}\n` +
      `on conflict (tab_key) do update set\n` +
      `  richmenu_id = excluded.richmenu_id,\n` +
      `  alias_id    = excluded.alias_id,\n` +
      `  image_file  = excluded.image_file,\n` +
      `  is_default  = excluded.is_default;\n`,
  );
}

main().catch((e) => die(e.message));

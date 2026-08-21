// 健康分數計算 — v2
//
// 設計原則:
//   AI 只負責「看圖給每一項 1-10 分」,總分一律由這裡算。
//   (v1 是讓 AI 自己算平均再乘 10,同一份分項每次跑出來的 total 會漂,
//    而 total 會進 sb_analysis_records、月結 rpc_settle_score 也吃它,不能漂。)
//
// 三診加權:舌診 40% / 面診 35% / 眼診 25%
//   舌診權重最高 —— 長庚舌診研究有實證的陽性預測值(舌淡→氣血虛 80.24%)。
//   眼診 v1 完全沒進分數(只有面 6 + 舌 5 = 11 項平均),v2 補進來。
//   某一診整組缺漏時(舊報告、AI 漏欄位),權重按剩下的診重新正規化,不當 0 分算。

export const SCORE_VERSION = 2;

/** 分項定義:順序就是 AI 輸出陣列的順序,改動要同步改 prompt.ts */
export const FACE_ZONES = ["額頭", "鼻部", "左頰", "右頰", "眼周", "下巴"] as const;
export const TONGUE_ITEMS = ["舌色", "苔色", "苔厚薄", "舌形", "濕潤度"] as const;
export const EYE_ITEMS = ["白睛", "黑睛", "眼瞼眼周", "乾潤度"] as const;

/** 區內權重(各自加總為 1) */
const FACE_WEIGHTS = [0.15, 0.20, 0.20, 0.15, 0.15, 0.15]; // 鼻(脾胃)、左頰(肝膽)為主要臟腑指標
const TONGUE_WEIGHTS = [0.25, 0.20, 0.20, 0.20, 0.15]; // 舌色最具實證權重
const EYE_WEIGHTS = [0.30, 0.30, 0.20, 0.20]; // 白睛(肝膽濕熱)、黑睛(腎精)為主

/** 三診之間的權重 */
const BLOCK_WEIGHTS = { tongue: 0.40, face: 0.35, eye: 0.25 };

export type Scores = {
  version: number;
  faceZone: Array<number | null>;
  tongue: Array<number | null>;
  eye: Array<number | null>;
  /** 各診小計,0-100,方便前端畫雷達圖 / 追蹤單項進步 */
  breakdown: { face: number | null; tongue: number | null; eye: number | null };
  /** 三診實際採用的權重(缺漏正規化後的結果) */
  weights: { face: number; tongue: number; eye: number };
  total: number;
  /** AI 自己算的總分,只留著比對用,不參與任何計算 */
  aiTotal?: number;
};

/**
 * 把 AI 給的一項分數收斂到 1-10;不是有效數字就回 null(視為缺漏)。
 * null / undefined / 空字串走 Number() 會變成 0 或 NaN,必須先擋掉 ——
 * 不然「AI 漏填」會被當成 1 分,平白扣掉使用者的分數。
 */
function clampItem(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, n));
}

/**
 * 一個診的加權平均(1-10)。
 * 只有部分項目缺漏時,用有分數的項目重新正規化;整組缺漏回 null。
 * items 保留原本的長度與位置(缺的填 null),不然分項會對不上項目名稱。
 */
function blockAverage(
  raw: unknown,
  weights: number[],
): { avg: number | null; items: Array<number | null> } {
  const arr = Array.isArray(raw) ? raw : [];
  const items: Array<number | null> = [];
  let sum = 0;
  let wsum = 0;

  for (let i = 0; i < weights.length; i++) {
    const v = clampItem(arr[i]);
    items.push(v);
    if (v === null) continue;
    sum += v * weights[i];
    wsum += weights[i];
  }

  if (wsum === 0) return { avg: null, items: [] };
  return { avg: sum / wsum, items };
}

/**
 * 從 AI 報告算出健康分數,並把結果寫回 report.scores。
 * 三診全缺(不該發生)時回 null,交給呼叫端決定是否當成解析失敗。
 */
export function computeScores(report: Record<string, unknown>): Scores | null {
  const rawScores = (report?.scores ?? {}) as Record<string, unknown>;

  const face = blockAverage(rawScores.faceZone, FACE_WEIGHTS);
  const tongue = blockAverage(rawScores.tongue, TONGUE_WEIGHTS);
  const eye = blockAverage(rawScores.eye, EYE_WEIGHTS);

  // 缺漏的診不計權重,其餘按比例補回,避免「漏一診 = 直接扣分」
  const present: Array<[keyof typeof BLOCK_WEIGHTS, number]> = [];
  if (tongue.avg !== null) present.push(["tongue", BLOCK_WEIGHTS.tongue]);
  if (face.avg !== null) present.push(["face", BLOCK_WEIGHTS.face]);
  if (eye.avg !== null) present.push(["eye", BLOCK_WEIGHTS.eye]);
  if (present.length === 0) return null;

  const wsum = present.reduce((s, [, w]) => s + w, 0);
  const weights = { face: 0, tongue: 0, eye: 0 };
  let weighted = 0;
  for (const [key, w] of present) {
    const norm = w / wsum;
    weights[key] = Math.round(norm * 1000) / 1000;
    const avg = key === "tongue" ? tongue.avg! : key === "face" ? face.avg! : eye.avg!;
    weighted += avg * norm;
  }

  const to100 = (v: number | null) => (v === null ? null : Math.round(v * 10));
  const aiTotal = clampTotal(rawScores.total);

  return {
    version: SCORE_VERSION,
    faceZone: face.items,
    tongue: tongue.items,
    eye: eye.items,
    breakdown: { face: to100(face.avg), tongue: to100(tongue.avg), eye: to100(eye.avg) },
    weights,
    total: Math.min(100, Math.max(0, Math.round(weighted * 10))),
    ...(aiTotal === null ? {} : { aiTotal }),
  };
}

function clampTotal(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

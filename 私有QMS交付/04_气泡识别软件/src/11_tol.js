/* =====================================================================
 * 识别引擎 · 公差标准（纯计算）
 *   1. GB/T 1804-2000（等同 ISO 2768-1）一般公差：线性尺寸、圆角半径与倒角高度、角度
 *   2. GB/T 1800.2 / ISO 286-2 常用公差带：孔 D E F G H JS K M N P，轴 d e f g h js k m n p，≤500 mm
 *   查表结果一律标“需核对”；正式使用以企业受控的标准文本为准。
 * ===================================================================== */

/* ---------------- GB/T 1804 一般公差 ---------------- */
const GBT1804 = {
  linear: {
    title: '线性尺寸的极限偏差',
    rows: [
      { lo: 0.5, hi: 3, incLo: true, label: '0.5~3', f: '0.05', m: '0.1', c: '0.2', v: '' },
      { lo: 3, hi: 6, label: '>3~6', f: '0.05', m: '0.1', c: '0.3', v: '0.5' },
      { lo: 6, hi: 30, label: '>6~30', f: '0.1', m: '0.2', c: '0.5', v: '1' },
      { lo: 30, hi: 120, label: '>30~120', f: '0.15', m: '0.3', c: '0.8', v: '1.5' },
      { lo: 120, hi: 400, label: '>120~400', f: '0.2', m: '0.5', c: '1.2', v: '2.5' },
      { lo: 400, hi: 1000, label: '>400~1000', f: '0.3', m: '0.8', c: '2', v: '4' },
      { lo: 1000, hi: 2000, label: '>1000~2000', f: '0.5', m: '1.2', c: '3', v: '6' },
      { lo: 2000, hi: 4000, label: '>2000~4000', f: '', m: '2', c: '4', v: '8' },
    ],
  },
  radius: {
    title: '倒圆半径和倒角高度的极限偏差',
    rows: [
      { lo: 0.5, hi: 3, incLo: true, label: '0.5~3', f: '0.2', m: '0.2', c: '0.4', v: '0.4' },
      { lo: 3, hi: 6, label: '>3~6', f: '0.5', m: '0.5', c: '1', v: '1' },
      { lo: 6, hi: Infinity, label: '>6', f: '1', m: '1', c: '2', v: '2' },
    ],
  },
  angle: {
    title: '角度尺寸的极限偏差（按角度短边长度）',
    rows: [
      { lo: 0, hi: 10, incLo: true, label: '≤10', f: '1°', m: '1°', c: '1°30′', v: '3°' },
      { lo: 10, hi: 50, label: '>10~50', f: '0°30′', m: '0°30′', c: '1°', v: '2°' },
      { lo: 50, hi: 120, label: '>50~120', f: '0°20′', m: '0°20′', c: '0°30′', v: '1°' },
      { lo: 120, hi: 400, label: '>120~400', f: '0°10′', m: '0°10′', c: '0°15′', v: '0°30′' },
      { lo: 400, hi: Infinity, label: '>400', f: '0°5′', m: '0°5′', c: '0°10′', v: '0°20′' },
    ],
  },
};
const GBT1804_CLASSES = { f: '精密 f', m: '中等 m', c: '粗糙 c', v: '最粗 v' };

/** 度分秒写法 → 十进制度：'0°30′' → { value: '0.5', exact: true }；'0°20′' → { value: '0.3333', exact: false } */
function angleToDeg(text) {
  const t = String(text || '').trim();
  if (DEC_RE.test(t)) return { value: decTrim(t.replace(/^\+/, '')), exact: true };
  const m = /^(?:(\d+(?:\.\d+)?)\s*°)?\s*(?:(\d+(?:\.\d+)?)\s*′)?\s*(?:(\d+(?:\.\d+)?)\s*″)?$/.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  let v = m[1] || '0', exact = true;
  if (m[2]) { const q = decDivInt(m[2], 60, 4); v = decAdd(v, q.value); exact = exact && q.exact; }
  if (m[3]) { const q = decDivInt(m[3], 3600, 4); v = decAdd(v, q.value); exact = exact && q.exact; }
  return { value: decTrim(v), exact };
}

/** 一般公差：kind = linear | radius | angle；返回 { pm, text, basis, exact } 或 null（超出范围或该等级无规定） */
function generalTol(nominal, cls, kind) {
  const tab = GBT1804[kind || 'linear'];
  const c = String(cls || '').toLowerCase();
  if (!tab || !GBT1804_CLASSES[c]) return null;
  const x = kind === 'angle' ? 0 : parseFloat(nominal);
  if (!(x >= 0)) return null;
  const row = tab.rows.find((r) => (r.incLo ? x >= r.lo : x > r.lo) && x <= r.hi);
  if (!row || !row[c]) return null;
  const basis = 'GB/T 1804-' + c + '（' + (kind === 'angle' ? '角度短边 ' : '') + row.label + (kind === 'angle' ? '，需核对短边长度' : ' mm') + '）';
  if (kind === 'angle') {
    const d = angleToDeg(row[c]);
    return { pm: d.value, text: '±' + row[c], basis, exact: d.exact };
  }
  return { pm: row[c], text: '±' + row[c], basis, exact: true };
}

/* ---------------- ISO 286 常用公差带 ---------------- */
/* 尺寸分段（大于上一档、至本档，单位 mm） */
const ISO_STEPS = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
const ISO_STEP_LABEL = ISO_STEPS.map((hi, i) => (i ? '>' + ISO_STEPS[i - 1] + '~' : '≤') + hi);
/* 标准公差 IT5–IT11（µm） */
const ISO_IT = {
  5: [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9: [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
};
/* 轴的基本偏差（µm）：d–h 为上偏差 es，k–p 为下偏差 ei（k 为 IT4~IT7 的数值） */
const ISO_SHAFT_ES = {
  d: [-20, -30, -40, -50, -65, -80, -100, -120, -145, -170, -190, -210, -230],
  e: [-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135],
  f: [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68],
  g: [-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20],
  h: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
const ISO_SHAFT_EI = {
  k: [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5],
  m: [2, 4, 6, 7, 8, 9, 11, 13, 15, 17, 20, 21, 23],
  n: [4, 8, 10, 12, 15, 17, 20, 23, 27, 31, 34, 37, 40],
  p: [6, 12, 15, 18, 22, 26, 32, 37, 43, 50, 56, 62, 68],
};
/* 本原型支持的等级范围 */
const ISO_GRADES = {
  d: [5, 11], e: [5, 11], f: [5, 11], g: [5, 11], h: [5, 11], js: [5, 11], k: [5, 7], m: [5, 7], n: [5, 7], p: [5, 7],
  D: [5, 11], E: [5, 11], F: [5, 11], G: [5, 11], H: [5, 11], JS: [5, 11], K: [6, 8], M: [6, 8], N: [6, 8], P: [6, 7],
};

function isoStepIndex(size) {
  if (!(size > 0) || size > 500) return -1;
  return ISO_STEPS.findIndex((hi) => size <= hi);
}
/** js/JS：±IT/2；IT7~IT11 的奇数微米值取相邻较小的偶数（ISO 286-1） */
function jsHalf(it, grade) { return (grade >= 7 && it % 2 === 1 ? it - 1 : it) / 2; }

/**
 * 按公差带代号查上下偏差：isoFit('20', 'H7') → { upper: '+0.021', lower: '0', upUm: 21, loUm: 0, it: 21, ... }
 * 不支持的代号或尺寸返回 { error }
 */
function isoFit(nominal, code) {
  const m = /^(js|JS|[a-zA-Z])\s*(\d{1,2})$/.exec(String(code || '').trim());
  if (!m) return { error: '公差带代号格式不对（例如 H7、g6、js6）' };
  const letter = m[1], grade = parseInt(m[2], 10);
  const range = ISO_GRADES[letter];
  if (!range) return { error: '暂不支持基本偏差 ' + letter + '（支持孔 D E F G H JS K M N P、轴 d e f g h js k m n p）' };
  if (grade < range[0] || grade > range[1]) return { error: letter + grade + ' 超出本原型支持的等级范围（' + letter + range[0] + '~' + letter + range[1] + '）' };
  const size = parseFloat(nominal);
  const i = isoStepIndex(size);
  if (i < 0) return { error: '名义尺寸须大于 0 且不超过 500 mm' };
  const it = ISO_IT[grade][i];
  const hole = letter === letter.toUpperCase() && letter !== letter.toLowerCase();
  const l = letter.toLowerCase();
  let up, lo;
  if (l === 'js') { const h2 = jsHalf(it, grade); up = h2; lo = -h2; }
  else if (!hole && ISO_SHAFT_ES[l]) { up = ISO_SHAFT_ES[l][i]; lo = up - it; }
  else if (!hole && ISO_SHAFT_EI[l]) { lo = ISO_SHAFT_EI[l][i]; up = lo + it; }
  else if (hole && ISO_SHAFT_ES[l]) { lo = -ISO_SHAFT_ES[l][i]; up = lo + it; }
  else if (hole && ISO_SHAFT_EI[l]) {
    /* K、M、N（≤IT8）与 P（≤IT7）：ES = -ei + Δ，Δ = ITn - IT(n-1)；3 mm 以内 Δ = 0 */
    const delta = i === 0 ? 0 : it - ISO_IT[grade - 1][i];
    up = -ISO_SHAFT_EI[l][i] + delta;
    if (letter === 'M' && grade === 6 && i === 10) up = -9; // ISO 286-2：M6 在 250~315 mm 的特例
    lo = up - it;
  } else return { error: '暂不支持 ' + letter };
  return {
    code: letter + grade, kind: hole ? '孔' : '轴', grade, it, upUm: up, loUm: lo,
    upper: decSigned(umToMm(up)), lower: decSigned(umToMm(lo)),
    basis: 'ISO 286 ' + letter + grade + '（' + ISO_STEP_LABEL[i] + ' mm，IT' + grade + '=' + it + ' µm）',
  };
}

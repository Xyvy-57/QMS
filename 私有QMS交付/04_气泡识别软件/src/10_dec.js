/* =====================================================================
 * 识别引擎 · 十进制运算（纯计算，不依赖浏览器，可在 Node 单元测试中直接加载）
 *   公差、上下限一律用十进制字符串，不经过浮点数：20.00 + 0.10 = 20.10，18 - 0.021 = 17.979
 * ===================================================================== */
const DEC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** 十进制字符串 → { n: 带符号整数（原值 × 10^s）, s: 小数位数 }；不是合法数字时返回 null */
function decParse(v) {
  if (v == null) return null;
  let t = String(v).trim();
  if (!DEC_RE.test(t)) return null;
  let neg = false;
  if (t[0] === '+' || t[0] === '-') { neg = t[0] === '-'; t = t.slice(1); }
  const k = t.indexOf('.');
  const ip = k >= 0 ? t.slice(0, k) : t;
  const fp = k >= 0 ? t.slice(k + 1) : '';
  let n = BigInt((ip || '0') + fp);
  if (neg) n = -n;
  return { n, s: fp.length };
}
function decScaleTo(p, s) { return p.s === s ? p.n : p.n * (10n ** BigInt(s - p.s)); }
function decFormat(n, s) {
  const neg = n < 0n;
  let a = (neg ? -n : n).toString();
  if (s > 0) {
    a = a.padStart(s + 1, '0');
    a = a.slice(0, a.length - s) + '.' + a.slice(a.length - s);
  }
  return (neg && /[1-9]/.test(a) ? '-' : '') + a;
}
function decAdd(a, b) {
  const x = decParse(a), y = decParse(b);
  if (!x || !y) return null;
  const s = Math.max(x.s, y.s);
  return decFormat(decScaleTo(x, s) + decScaleTo(y, s), s);
}
function decNeg(a) { const x = decParse(a); return x ? decFormat(-x.n, x.s) : null; }
function decSub(a, b) { const nb = decNeg(b); return nb == null ? null : decAdd(a, nb); }
function decCmp(a, b) {
  const x = decParse(a), y = decParse(b);
  if (!x || !y) return null;
  const s = Math.max(x.s, y.s), p = decScaleTo(x, s), q = decScaleTo(y, s);
  return p < q ? -1 : p > q ? 1 : 0;
}
function decIsZero(a) { const x = decParse(a); return !!x && x.n === 0n; }
function decAbs(a) { const x = decParse(a); return x ? decFormat(x.n < 0n ? -x.n : x.n, x.s) : null; }
function decTrim(a) { const t = String(a == null ? '' : a); return t.indexOf('.') >= 0 ? t.replace(/0+$/, '').replace(/\.$/, '') : t; }
function decMax(a, b) { const c = decCmp(a, b); return c == null ? null : c >= 0 ? a : b; }
function decMin(a, b) { const c = decCmp(a, b); return c == null ? null : c <= 0 ? a : b; }

/** 带符号的偏差写法：+0.10 / -0.05 / 0 */
function decSigned(a) {
  const x = decParse(a);
  if (!x) return '';
  if (x.n === 0n) return '0';
  const t = decFormat(x.n, x.s);
  return x.n > 0n ? '+' + t : t;
}

/** a ÷ d（d 为正整数），四舍五入到 places 位；exact 表示是否整除（角度的分、秒换算成度时会用到） */
function decDivInt(a, d, places) {
  const x = decParse(a);
  if (!x || !(d > 0)) return null;
  const num = (x.n < 0n ? -x.n : x.n) * (10n ** BigInt(places));
  const den = (10n ** BigInt(x.s)) * BigInt(d);
  let q = num / den;
  const r = num % den;
  if (r * 2n >= den) q += 1n;
  return { value: decFormat(x.n < 0n ? -q : q, places), exact: r === 0n };
}

/** 微米（整数或 .5）→ 毫米字符串：21 → 0.021，-7 → -0.007，6.5 → 0.0065，0 → 0 */
function umToMm(um) {
  if (!um) return '0';
  const tenths = Math.round(um * 10);
  if (tenths % 10 !== 0) return decFormat(BigInt(tenths), 4);
  return decFormat(BigInt(tenths / 10), 3);
}

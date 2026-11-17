#!/usr/bin/env node
/**
 * 二维码单元测试（纯 Node，不开浏览器；build.mjs 构建后自动运行）
 *   node tests/unit.mjs
 * 用一套独立写的解码器把 src/44_qr.js 生成的二维码解回原文：
 *   功能区判定、掩模公式、之字形读取顺序、GF(256) 运算（对数表）都与编码器分开实现；
 * 再对照标准里的已知数值：HELLO WORLD 1-M 的纠错码字、格式信息、版本信息、各版本码字总数。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src', '44_qr.js'), 'utf8');
const ctx = { COMPONENTS: {}, computed: (f) => ({ get value() { return f(); } }), h: () => null, TextEncoder, Math, Array, String, Error, Infinity };
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__qr = { qrEncode, qrRemainder, qrDivisor, qrFormatBits, qrVersionBits, QR_EC, QR_ALIGN, qrDataCodewords };', ctx, { filename: '44_qr.js' });
const Q = ctx.__qr;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (detail ? '：' + detail : '')); } };

/* ---------- 独立实现：GF(256) 对数表 ---------- */
const EXP = new Array(512), LOG = new Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/* ---------- 1. 已知数值 ---------- */
{
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  const ec = Array.from(Q.qrRemainder(data, Q.qrDivisor(10)));
  ok('HELLO WORLD 1-M 的纠错码字', JSON.stringify(ec) === JSON.stringify([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]), JSON.stringify(ec));
  const fmt = { 'M,0': 0x5412, 'L,0': 0x77c4, 'Q,0': 0x355f, 'H,0': 0x1689, 'M,1': 0x5125, 'M,7': 0x4aa0, 'L,7': 0x6976 };
  Object.keys(fmt).forEach((k) => { const [e, m] = k.split(','); ok('格式信息 ' + k, Q.qrFormatBits(e, +m) === fmt[k], Q.qrFormatBits(e, +m).toString(2)); });
  const all = [];
  ['L', 'M', 'Q', 'H'].forEach((e) => { for (let m = 0; m < 8; m++) all.push(Q.qrFormatBits(e, m)); });
  let minD = 99;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { let d = all[i] ^ all[j], c = 0; while (d) { c += d & 1; d >>>= 1; } minD = Math.min(minD, c); }
  ok('32 个格式信息码字两两汉明距离 ≥ 7（BCH(15,5)）', minD >= 7, '最小距离 ' + minD);
  const ver = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
  Object.keys(ver).forEach((v) => ok('版本信息 V' + v, Q.qrVersionBits(+v) === ver[v], Q.qrVersionBits(+v).toString(16)));
  for (let v = 1; v <= 10; v++) {
    let bits = (16 * v + 128) * v + 64;
    if (v >= 2) { const na = Math.floor(v / 7) + 2; bits -= (25 * na - 10) * na - 55; if (v >= 7) bits -= 36; }
    const total = Math.floor(bits / 8);
    ['L', 'M', 'Q', 'H'].forEach((e) => { const r = Q.QR_EC[e][v - 1]; ok('V' + v + '-' + e + ' 码字总数', r[1] * r[2] + r[3] * r[4] + (r[1] + r[3]) * r[0] === total, total); });
    const na = v === 1 ? 0 : Math.floor(v / 7) + 2, size = v * 4 + 17, pos = [];
    if (na) { const step = Math.floor((v * 4 + na * 2 + 1) / (na * 2 - 2)) * 2; pos.unshift(size - 7); for (let i = 1; i < na - 1; i++) pos.unshift(pos[0] - step); pos.unshift(6); }
    ok('V' + v + ' 校正图形位置', JSON.stringify(Array.from(Q.QR_ALIGN[v - 1])) === JSON.stringify(pos), JSON.stringify(pos));
  }
}

/* ---------- 2. 独立解码器 ---------- */
const MASK = [
  (i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0, (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];
const ECL_OF = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };
function decode(mod) {
  const size = mod.length, ver = (size - 17) / 4;
  const dark = (row, col) => mod[row][col] === true;
  /* 定位图形、定时图形、暗模块 */
  const finderOk = (r0, c0) => { for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) { const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3)); if (dark(r0 + r, c0 + c) !== (ring !== 2)) return false; } return true; };
  if (!finderOk(0, 0) || !finderOk(0, size - 7) || !finderOk(size - 7, 0)) throw new Error('定位图形不对');
  for (let k = 8; k < size - 8; k++) if (dark(6, k) !== (k % 2 === 0) || dark(k, 6) !== (k % 2 === 0)) throw new Error('定时图形不对');
  if (!dark(size - 8, 8)) throw new Error('暗模块不对');
  /* 格式信息：两份都读，必须一致且是合法码字 */
  let f1 = 0, f2 = 0;
  const seq1 = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]]; // [行, 列]，第 i 个是 bit i
  seq1.forEach(([r, c], i) => { if (dark(r, c)) f1 |= 1 << i; });
  for (let i = 0; i < 8; i++) if (dark(8, size - 1 - i)) f2 |= 1 << i;
  for (let i = 8; i < 15; i++) if (dark(size - 15 + i, 8)) f2 |= 1 << i;
  if (f1 !== f2) throw new Error('两份格式信息不一致');
  const raw = f1 ^ 0x5412;
  let rem = raw;
  for (let i = 14; i >= 10; i--) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  if (rem !== 0) throw new Error('格式信息校验失败');
  const ecl = ECL_OF[raw >> 13], mask = (raw >> 10) & 7;
  /* 版本信息 */
  if (ver >= 7) {
    let v1 = 0, v2 = 0;
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); if (dark(b, a)) v1 |= 1 << i; if (dark(a, b)) v2 |= 1 << i; }
    if (v1 !== v2 || v1 >> 12 !== ver) throw new Error('版本信息不对');
  }
  /* 功能区（与编码器分开判定） */
  const na = ver === 1 ? 0 : Math.floor(ver / 7) + 2;
  const pos = [];
  if (na) { const step = Math.floor((ver * 4 + na * 2 + 1) / (na * 2 - 2)) * 2; pos.unshift(size - 7); for (let i = 1; i < na - 1; i++) pos.unshift(pos[0] - step); pos.unshift(6); }
  const inAlign = (r, c) => pos.some((pr, a) => pos.some((pc, b) => !((a === 0 && b === 0) || (a === 0 && b === na - 1) || (a === na - 1 && b === 0)) && Math.abs(r - pr) <= 2 && Math.abs(c - pc) <= 2));
  const reserved = (r, c) => (r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9) || r === 6 || c === 6 || inAlign(r, c)
    || (ver >= 7 && ((r < 6 && c >= size - 11 && c <= size - 9) || (c < 6 && r >= size - 11 && r <= size - 9)));
  /* 之字形读取：两列一组，从右往左，上下交替 */
  const bits = [];
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let k = 0; k < size; k++) {
      const r = up ? size - 1 - k : k;
      for (const c of [col, col - 1]) if (!reserved(r, c)) bits.push(dark(r, c) !== MASK[mask](r, c) ? 1 : 0);
    }
    up = !up;
  }
  const cw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
  /* 拆块并校验伴随式（全为 0 才说明纠错码字正确） */
  const e = Q.QR_EC[ecl][ver - 1], sizes = new Array(e[1]).fill(e[2]).concat(new Array(e[3]).fill(e[4])), nb = sizes.length, ecn = e[0];
  const blocks = sizes.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(...sizes); i++) for (let b = 0; b < nb; b++) if (i < sizes[b]) blocks[b].push(cw[k++]);
  for (let i = 0; i < ecn; i++) for (let b = 0; b < nb; b++) blocks[b].push(cw[k++]);
  blocks.forEach((blk, bi) => {
    for (let s = 0; s < ecn; s++) {
      let acc = 0;
      blk.forEach((c) => { acc = gmul(acc, EXP[s]) ^ c; });
      if (acc !== 0) throw new Error('第 ' + (bi + 1) + ' 块伴随式 S' + s + ' 不为 0');
    }
  });
  const data = [];
  blocks.forEach((blk, b) => blk.slice(0, sizes[b]).forEach((c) => data.push(c)));
  /* 解析字节模式 */
  let p = 0;
  const read = (n) => { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((data[(p >> 3)] >> (7 - (p & 7))) & 1); p++; } return v; };
  if (read(4) !== 4) throw new Error('不是字节模式');
  const len = read(ver < 10 ? 8 : 16);
  const out = [];
  for (let i = 0; i < len; i++) out.push(read(8));
  return { text: new TextDecoder().decode(new Uint8Array(out)), ecl, mask, ver };
}

/* ---------- 3. 往返：各种长度 × 纠错等级 × 掩模 ---------- */
const sample = (n) => { let s = 'http://192.168.1.20:5180/#/scan/WO-2611-011?ab='; while (s.length < n) s += 'X0123456789'; return s.slice(0, n); };
const lens = [0, 1, 7, 13, 17, 26, 32, 41, 42, 53, 62, 84, 106, 122, 152, 180, 213];
let trips = 0;
['L', 'M', 'Q', 'H'].forEach((e) => {
  lens.forEach((n, li) => {
    const text = sample(n);
    if (4 + (n > 255 ? 16 : 8) + n * 8 > Q.qrDataCodewords(10, e) * 8 - 8) return;
    const masks = li % 3 === 0 ? [0, 1, 2, 3, 4, 5, 6, 7] : [undefined];
    masks.forEach((m) => {
      let r;
      try { r = Q.qrEncode(text, e, m); } catch (err) { ok('编码 ' + e + ' 长度 ' + n, false, err.message); return; }
      try {
        const d = decode(r.modules.map((row) => Array.from(row)));
        trips++;
        ok('往返 ' + e + ' 长度 ' + n + ' 掩模 ' + r.mask, d.text === text && d.ecl === e && d.mask === r.mask && d.ver === r.version, JSON.stringify({ ver: r.version, d: d.text.slice(0, 20) }));
      } catch (err) { ok('解码 ' + e + ' 长度 ' + n + ' V' + r.version + ' 掩模 ' + r.mask, false, err.message); }
    });
  });
});
for (const t of ['WO-2611-011', '工单 WO-2611-064 · 流转卡', 'HELLO WORLD']) {
  const r = Q.qrEncode(t);
  try { const d = decode(r.modules.map((row) => Array.from(row))); trips++; ok('往返 “' + t + '”', d.text === t, d.text); } catch (err) { ok('解码 “' + t + '”', false, err.message); }
}
ok('网址选到最小版本（41 字节、M 级 → V3）', Q.qrEncode(sample(41), 'M').version === 3, String(Q.qrEncode(sample(41), 'M').version));
let tooLong = '';
try { Q.qrEncode(sample(400), 'M'); } catch (err) { tooLong = err.message; }
ok('超长内容给出明确提示', /内容太长/.test(tooLong), tooLong);

if (fail) { console.log('二维码单元测试：' + fail + ' 项没有通过（通过 ' + pass + ' 项）'); process.exit(1); }
console.log('二维码单元测试通过：' + pass + ' 项（独立解码往返 ' + trips + ' 次，覆盖版本 1–10、四种纠错等级、八种掩模）');

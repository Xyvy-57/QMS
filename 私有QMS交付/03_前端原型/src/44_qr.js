/* =====================================================================
 * 二维码（QR Code，ISO/IEC 18004）：工单流转卡上的扫码入口
 *   字节模式（UTF-8），纠错等级默认 M，版本 1–10 自动选择（M 级最多约 210 字节，放一个网址足够）。
 *   零依赖：Reed–Solomon 纠错、分块交错、八种掩模按罚分规则选最优。
 *   正确性由 tests/unit.mjs 用独立实现的解码器反解校验（构建时自动运行）。
 * ===================================================================== */

/** 每个版本的纠错块结构：[每块纠错码字数, 第一组块数, 第一组每块数据码字, 第二组块数, 第二组每块数据码字] */
const QR_EC = {
  L: [[7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
  M: [[10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
  Q: [[13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0], [18, 2, 15, 2, 16], [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19], [20, 4, 16, 4, 17], [24, 6, 19, 2, 20]],
  H: [[17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0], [22, 2, 11, 2, 12], [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15], [24, 4, 12, 4, 13], [28, 6, 15, 2, 16]],
};
/** 校正图形中心坐标（版本 1 没有） */
const QR_ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
/** 格式信息里的纠错等级编码 */
const QR_ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const QR_MAX_VER = 10;

/** GF(256) 乘法，本原多项式 x^8+x^4+x^3+x^2+1（0x11D） */
function qrGfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
/** 生成多项式（根为 α^0 … α^(n-1)），按降幂排列、省略首项 1 */
function qrDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = qrGfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = qrGfMul(root, 2);
  }
  return r;
}
/** 数据码字除以生成多项式的余式 = 纠错码字 */
function qrRemainder(data, div) {
  const r = new Array(div.length).fill(0);
  data.forEach((b) => {
    const f = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < div.length; i++) r[i] ^= qrGfMul(div[i], f);
  });
  return r;
}
function qrBlockSizes(ver, ecl) {
  const e = QR_EC[ecl][ver - 1];
  return { ec: e[0], blocks: new Array(e[1]).fill(e[2]).concat(new Array(e[3]).fill(e[4])) };
}
function qrDataCodewords(ver, ecl) { return qrBlockSizes(ver, ecl).blocks.reduce((a, x) => a + x, 0); }
/** 字节模式的字符计数位数：版本 1–9 为 8 位，10–26 为 16 位 */
function qrCountBits(ver) { return ver < 10 ? 8 : 16; }
/** 格式信息：2 位纠错等级 + 3 位掩模号，BCH(15,5) 纠错后与 101010000010010 异或 */
function qrFormatBits(ecl, mask) {
  const data = (QR_ECL_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
/** 版本信息（版本 7 起）：6 位版本号 + BCH(18,6) 的 12 位余式 */
function qrVersionBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}
function qrMaskHit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/**
 * 生成二维码矩阵。modules[y][x] 为 true 表示深色模块（x 为列、y 为行），不含四周 4 个模块的空白区。
 * @param {string} text  内容（按 UTF-8 编码）
 * @param {string} [ecl] 纠错等级 L / M / Q / H，默认 M
 * @param {number} [forceMask] 指定掩模 0–7（测试用）；不指定时按罚分选最优
 */
function qrEncode(text, ecl, forceMask) {
  ecl = QR_EC[ecl] ? ecl : 'M';
  const bytes = Array.from(new TextEncoder().encode(String(text == null ? '' : text)));
  let ver = 0;
  for (let v = 1; v <= QR_MAX_VER; v++) {
    if (4 + qrCountBits(v) + bytes.length * 8 <= qrDataCodewords(v, ecl) * 8) { ver = v; break; }
  }
  if (!ver) throw new Error('内容太长，二维码放不下（最多约 ' + (qrDataCodewords(QR_MAX_VER, ecl) - 3) + ' 字节）');

  /* 1. 数据位流：模式指示 0100 + 字符计数 + 数据 + 终止符 + 补齐到整字节 + 填充码字 */
  const cap = qrDataCodewords(ver, ecl) * 8;
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4);
  put(bytes.length, qrCountBits(ver));
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }

  /* 2. 分块计算纠错码字，再按列交错：先数据码字，后纠错码字 */
  const sz = qrBlockSizes(ver, ecl), div = qrDivisor(sz.ec);
  const dBlocks = [], eBlocks = [];
  let k = 0;
  sz.blocks.forEach((n) => { const d = data.slice(k, k + n); k += n; dBlocks.push(d); eBlocks.push(qrRemainder(d, div)); });
  const all = [];
  const maxD = Math.max.apply(null, sz.blocks);
  for (let i = 0; i < maxD; i++) dBlocks.forEach((d) => { if (i < d.length) all.push(d[i]); });
  for (let i = 0; i < sz.ec; i++) eBlocks.forEach((e) => all.push(e[i]));

  /* 3. 功能图形：定位、分隔、定时、校正、格式与版本信息区 */
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = QR_ALIGN[ver - 1], na = al.length;
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (mask) => {
    const b = qrFormatBits(ecl, mask), bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    const vb = qrVersionBits(ver);
    for (let i = 0; i < 18; i++) {
      const dark = ((vb >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark); set(b, a, dark);
    }
  }

  /* 4. 码字按“之”字形从右下角两列一组往上、往下交替排布（跳过第 6 列定时图形） */
  let bi = 0;
  const total = all.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < total) { mod[y][x] = ((all[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1; bi++; }
      }
    }
  }

  /* 5. 掩模：八种都试一遍，取罚分最低的 */
  const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && qrMaskHit(m, x, y)) mod[y][x] = !mod[y][x]; };
  let best = typeof forceMask === 'number' && forceMask >= 0 && forceMask <= 7 ? forceMask : -1;
  if (best < 0) {
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const sc = qrPenalty(mod, size);
      if (sc < bestScore) { bestScore = sc; best = m; }
      applyMask(m);
    }
  }
  applyMask(best); drawFormat(best);
  return { version: ver, ecl, mask: best, size, modules: mod };
}

/** 罚分规则 N1–N4（同色连续、2×2 同色块、类定位图形、深浅比例） */
function qrPenalty(mod, size) {
  let score = 0;
  const addHist = (len, hist) => { if (hist[0] === 0) len += size; hist.pop(); hist.unshift(len); };
  const countFinder = (h) => {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  };
  const terminate = (color, len, hist) => { if (color) { addHist(len, hist); len = 0; } len += size; addHist(len, hist); return countFinder(hist); };
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let color = false, run = 0;
      const hist = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const v = pass === 0 ? mod[a][b] : mod[b][a];
        if (v === color) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else {
          addHist(run, hist);
          if (!color) score += countFinder(hist) * 40;
          color = v; run = 1;
        }
      }
      score += terminate(color, run, hist) * 40;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
    }
  }
  let dark = 0;
  mod.forEach((row) => row.forEach((v) => { if (v) dark++; }));
  const tot = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - tot * 10) / tot) - 1) * 10;
  return score;
}

/** 二维码组件：<qr-code :text="..." :size="120"/>，输出 SVG（打印清晰） */
COMPONENTS['qr-code'] = {
  props: { text: String, size: { type: Number, default: 120 }, ecl: { type: String, default: 'M' } },
  setup(p) {
    const q = computed(() => { try { return qrEncode(p.text || '', p.ecl); } catch (e) { return null; } });
    const path = computed(() => {
      if (!q.value) return '';
      let d = '';
      q.value.modules.forEach((row, y) => row.forEach((v, x) => { if (v) d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z'; }));
      return d;
    });
    return () => (q.value
      ? h('svg', { width: p.size, height: p.size, viewBox: '0 0 ' + (q.value.size + 8) + ' ' + (q.value.size + 8), 'shape-rendering': 'crispEdges', role: 'img', 'aria-label': '二维码', class: 'shrink-0' }, [
        h('rect', { x: 0, y: 0, width: q.value.size + 8, height: q.value.size + 8, fill: '#fff' }),
        h('path', { d: path.value, fill: '#000' }),
      ])
      : h('div', { class: 'text-xs text-rose-600' }, '内容太长，生成不了二维码'));
  },
};

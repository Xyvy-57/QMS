/* =====================================================================
 * 识别引擎 · 气泡摆放与编号（纯计算）
 *   气泡放在标注旁边：不压文字、不和别的气泡重叠，优先放在上方和右上方；引线指向标注框最近的一点
 * ===================================================================== */

function balloonRadius(pageW) { return Math.round(Math.max(11, Math.min(26, pageW * 0.0095))); }
function circleHitsBox(x, y, r, b) {
  const nx = Math.max(b.x, Math.min(x, b.x + b.w)), ny = Math.max(b.y, Math.min(y, b.y + b.h));
  return Math.hypot(nx - x, ny - y) < r;
}

/** 阅读顺序：按页、再按行带（页高 6%）从上到下，行内从左到右 */
function readingOrder(items, pages) {
  return items.slice().sort((a, b) => {
    if ((a.page || 1) !== (b.page || 1)) return (a.page || 1) - (b.page || 1);
    const pg = (pages && pages[(a.page || 1) - 1]) || { h: 1000 };
    const band = Math.max(20, pg.h * 0.06);
    const pa = boxCenter(a.anchor), pb = boxCenter(b.anchor);
    const ra = Math.floor(pa.y / band), rb = Math.floor(pb.y / band);
    return ra !== rb ? ra - rb : pa.x - pb.x;
  });
}

/** 按阅读顺序重新编号（气泡号只是显示号，不改特性 ID） */
function renumber(chars, pages) {
  readingOrder(chars, pages).forEach((c, i) => { c.no = i + 1; });
  return chars;
}

/** 气泡圆周到标注框最近点的引线；气泡压在框上时返回 null */
function leaderLine(bx, by, r, box) {
  const nx = Math.max(box.x, Math.min(bx, box.x + box.w)), ny = Math.max(box.y, Math.min(by, box.y + box.h));
  const dx = nx - bx, dy = ny - by, d = Math.hypot(dx, dy);
  if (d <= r + 1) return null;
  return { x1: bx + (dx / d) * r, y1: by + (dy / d) * r, x2: nx, y2: ny };
}

/**
 * 给还没有气泡位置的特性找位置（opts.all = true 时全部重新摆放）
 *   chars[i] = { page, anchor: {x,y,w,h}, balloon?: {x,y} }；pages[i] = { w, h }；opts.obstacles = { [page]: [box…] } 其它文字框
 */
function placeBalloons(chars, pages, opts) {
  opts = opts || {};
  const dirs = [[0, -1], [1, -1], [1, 0], [-1, -1], [1, 1], [0, 1], [-1, 0], [-1, 1]];
  const byPage = {};
  chars.forEach((c) => { const p = c.page || 1; (byPage[p] = byPage[p] || []).push(c); });
  Object.keys(byPage).forEach((pk) => {
    const list = byPage[pk];
    const page = pages[pk - 1] || { w: 2000, h: 1400 };
    const r = opts.r || balloonRadius(page.w);
    const margin = r * 1.4;
    const placed = list.filter((c) => c.balloon && !opts.all).map((c) => ({ x: c.balloon.x, y: c.balloon.y }));
    const obstacles = ((opts.obstacles && opts.obstacles[pk]) || []).concat(list.map((c) => c.anchor));
    readingOrder(list, pages).forEach((c) => {
      if (c.balloon && !opts.all) return;
      const b = c.anchor, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      let best = null, bestScore = Infinity;
      [r * 1.7, r * 2.7, r * 3.9, r * 5.6].forEach((d, di) => {
        dirs.forEach(([ux, uy], k) => {
          const len = Math.hypot(ux, uy);
          const ex = ux > 0 ? b.x + b.w : ux < 0 ? b.x : cx;
          const ey = uy > 0 ? b.y + b.h : uy < 0 ? b.y : cy;
          const x = ex + (ux / len) * d, y = ey + (uy / len) * d;
          if (x < margin || y < margin || x > page.w - margin || y > page.h - margin) return;
          let score = di * 2 + k * 0.06;
          placed.forEach((p) => { const dd = Math.hypot(p.x - x, p.y - y); if (dd < r * 2.5) score += (r * 2.5 - dd) * 4; });
          obstacles.forEach((o) => { if (o !== b && circleHitsBox(x, y, r * 1.15, o)) score += 30; });
          if (circleHitsBox(x, y, r * 1.05, b)) score += 100;
          if (score < bestScore) { bestScore = score; best = { x, y }; }
        });
      });
      c.balloon = best || { x: Math.min(page.w - margin, Math.max(margin, cx)), y: Math.max(margin, b.y - r * 2) };
      c.balloon.x = Math.round(c.balloon.x); c.balloon.y = Math.round(c.balloon.y);
      placed.push(c.balloon);
    });
  });
  return chars;
}

/* Jigsaw Piece Creator: create page.
 * Cut curves are smooth Catmull-Rom splines through each profile's control
 * points; knob depth scales with edge length. Seeded and deterministic:
 * the same seed always cuts the same board.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    dropzone: $("dropzone"), fileInput: $("fileInput"),
    sampleBtn: $("sampleBtn"), imgInfo: $("imgInfo"),
    knobList: $("knobList"), knobSource: $("knobSource"),
    tuneNote: $("tuneNote"), tuneBody: $("tuneBody"), tuneCurve: $("tuneCurve"),
    tuneList: $("tuneList"), tuneName: $("tuneName"),
    tuneResetBtn: $("tuneResetBtn"), tuneSaveBtn: $("tuneSaveBtn"), tuneMsg: $("tuneMsg"),
    cols: $("cols"), rows: $("rows"), seed: $("seed"),
    shuffleBtn: $("shuffleBtn"), tabSize: $("tabSize"), tabSizeVal: $("tabSizeVal"),
    lockAspect: $("lockAspect"), targetPieces: $("targetPieces"), calcGridBtn: $("calcGridBtn"),
    piecePx: $("piecePx"), gapPx: $("gapPx"), bgWhite: $("bgWhite"),
    cutLines: $("cutLines"), sheetInfo: $("sheetInfo"),
    paperSize: $("paperSize"), printDpi: $("printDpi"),
    edgeMargin: $("edgeMargin"), paperFit: $("paperFit"),
    exportSheetBtn: $("exportSheetBtn"), exportAssembledBtn: $("exportAssembledBtn"),
    preview: $("preview"), sheetPreview: $("sheetPreview"),
  };

  const state = {
    templates: [],        // [{id,name,description,controlPoints:[[x,y]...]}]
    knobMode: "mix",      // template id or "mix" (random profile per edge)
    overrides: {},        // runtime-only tuned points per template id (never auto-saved)
    dbUp: false,          // save-to-database available only when the API answers
    img: null,            // HTMLImageElement / canvas source, used at native ratio
    imgName: "",
    board: null,          // generated pieces (outlines in cell-pixel space)
  };

  // Paper sizes in mm: [width, height].
  const PAPER_MM = {
    A4P: [210, 297], A4L: [297, 210],
    A3P: [297, 420], A3L: [420, 297],
    LP: [215.9, 279.4], LL: [279.4, 215.9],
  };
  const MM_PER_IN = 25.4;
  const mmToPx = (mm, dpi) => Math.round((mm / MM_PER_IN) * dpi);

  // ---------- seeded RNG (deterministic per seed within this tool) ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Catmull-Rom spline ----------
  function catmullRomPoint(pts, i, t) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[Math.min(i + 1, pts.length - 1)];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const t2 = t * t, t3 = t2 * t;
    return [
      0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    ];
  }

  // Sample a full template curve (for thumbnails): global t in 0..1
  function sampleTemplateCurve(cp, samples) {
    const out = [];
    const segs = cp.length - 1;
    for (let s = 0; s <= samples; s++) {
      const gt = (s / samples) * segs;
      const i = Math.min(Math.floor(gt), segs - 1);
      out.push(catmullRomPoint(cp, i, gt - i));
    }
    return out;
  }

  // ---------- grid and piece proportionality ----------
  // Compute rows/cols that multiply to approximately targetPieceCount and preserve
  // aspect ratio so cells stay square (matching Piece-It engine).
  function calculateProportionalGrid(targetPieceCount, aspect) {
    const target = Math.max(1, targetPieceCount || 64);
    const asp = aspect > 0 ? aspect : 1;
    let cols = Math.round(Math.sqrt(target * asp));
    let rows = Math.round(target / Math.max(cols, 1));
    cols = Math.max(1, Math.min(30, cols));
    rows = Math.max(1, Math.min(30, rows));
    return { cols, rows };
  }

  // ---------- board generation (seeded, deterministic) ----------
  function adaptiveResolution(total) {
    if (total >= 400) return 4;
    if (total >= 100) return 6;
    return 10;
  }

  function pickTemplate(rng) {
    if (state.knobMode !== "mix") {
      return state.templates.find((t) => t.id === state.knobMode) || state.templates[0];
    }
    return state.templates[(rng() * state.templates.length) | 0];
  }

  function generateBoard(seed, rows, cols, cellW, cellH) {
    const rng = mulberry32(seed);
    const pieces = [];
    const at = (x, y) => pieces[y * cols + x];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        pieces.push({
          cx: x, cy: y,
          top: { type: "flat", tpl: null }, right: { type: "flat", tpl: null },
          bottom: { type: "flat", tpl: null }, left: { type: "flat", tpl: null },
          outline: [],
        });
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const p = at(x, y);
        if (x < cols - 1) {
          const n = at(x + 1, y);
          const tabOut = rng() < 0.5;
          const tpl = pickTemplate(rng);
          p.right = { type: tabOut ? "tab" : "blank", tpl };
          n.left = { type: tabOut ? "blank" : "tab", tpl }; // SAME template
        }
        if (y < rows - 1) {
          const n = at(x, y + 1);
          const tabOut = rng() < 0.5;
          const tpl = pickTemplate(rng);
          p.bottom = { type: tabOut ? "tab" : "blank", tpl };
          n.top = { type: tabOut ? "blank" : "tab", tpl };
        }
      }
    }
    const res = adaptiveResolution(pieces.length);
    const tabSizeRatio = parseFloat(els.tabSize.value) || 0.2;
    for (const p of pieces) p.outline = buildOutline(p, tabSizeRatio, res, cellW, cellH);
    return { rows, cols, seed, pieces, cellW, cellH, boardW: cols * cellW, boardH: rows * cellH };
  }

  // Outline in cell-pixel space, Y-up: (0,H)=top-left ... (0,0)=bottom-left.
  // Tab depth and width scale from refLen = min(cellW, cellH) so tabs have
  // the exact same proportional size and profile on every edge, even if cells are non-square.
  function buildOutline(piece, tabSizeRatio, resolution, cellW, cellH) {
    const pts = [];
    const refLen = Math.min(cellW, cellH);
    appendEdge(pts, [0, cellH], [cellW, cellH], piece.top, tabSizeRatio, resolution, refLen);
    appendEdge(pts, [cellW, cellH], [cellW, 0], piece.right, tabSizeRatio, resolution, refLen);
    appendEdge(pts, [cellW, 0], [0, 0], piece.bottom, tabSizeRatio, resolution, refLen);
    appendEdge(pts, [0, 0], [0, cellH], piece.left, tabSizeRatio, resolution, refLen);
    return pts;
  }

  function appendEdge(pts, start, end, edge, tabSizeRatio, resolution, refLen) {
    if (edge.type === "flat" || !edge.tpl) { pts.push(start); return; }
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const len = Math.hypot(dx, dy);
    const dir = [dx / len, dy / len];
    const normal = [-dir[1], dir[0]]; // outward from the piece
    const effectiveRef = refLen || len;
    const tabDepth = tabSizeRatio * effectiveRef;
    const direction = edge.type === "tab" ? 1 : -1;
    const k = Math.min(1, effectiveRef / len);
    // Runtime tune overrides the stored points for this template id (unsaved).
    const src = state.overrides[edge.tpl.id] || edge.tpl.controlPoints;
    const cp = src.map(([tx, ty], idx) => {
      // Anchors at the start and end of the edge stay fixed at 0 and 1;
      // knob interior scales uniformly around 0.5 so tabs maintain proportional width across edges.
      const isEndpoint = idx === 0 || idx === src.length - 1;
      const effectiveTx = isEndpoint ? tx : (0.5 + (tx - 0.5) * k);
      return [
        start[0] + (end[0] - start[0]) * effectiveTx + normal[0] * ty * tabDepth * direction,
        start[1] + (end[1] - start[1]) * effectiveTx + normal[1] * ty * tabDepth * direction,
      ];
    });
    for (let i = 0; i < cp.length - 1; i++) {
      for (let s = 0; s < resolution; s++) {
        pts.push(catmullRomPoint(cp, i, s / resolution));
      }
    }
  }

  // ---------- image handling (always native ratio; whole image, no crop) ----------
  function srcW() { return state.img ? (state.img.naturalWidth || state.img.width) : 0; }
  function srcH() { return state.img ? (state.img.naturalHeight || state.img.height) : 0; }

  function drawFull(ctx, dx, dy, dw, dh) {
    ctx.drawImage(state.img, 0, 0, srcW(), srcH(), dx, dy, dw, dh);
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      state.img = img; state.imgName = file.name.replace(/\.[^.]+$/, "");
      showThumb(url);
      if (els.lockAspect && els.lockAspect.checked) {
        const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
        const target = parseInt(els.targetPieces && els.targetPieces.value) || 64;
        const grid = calculateProportionalGrid(target, aspect);
        els.cols.value = grid.cols;
        els.rows.value = grid.rows;
      }
      regenerate();
    };
    img.src = url;
  }

  function clearDropzoneKeepInput() {
    // remove everything except the hidden file input (keep it attached so click() works)
    [...els.dropzone.children].forEach((ch) => {
      if (ch !== els.fileInput) ch.remove();
    });
  }

  function showThumb(url) {
    els.dropzone.classList.add("has-img");
    clearDropzoneKeepInput();
    const im = document.createElement("img");
    im.src = url; im.alt = "uploaded image";
    els.dropzone.appendChild(im);
  }

  function makeSampleImage() {
    const c = document.createElement("canvas");
    c.width = 1200; c.height = 900;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 1200, 900);
    grad.addColorStop(0, "#ff595e"); grad.addColorStop(0.35, "#ffca3a");
    grad.addColorStop(0.65, "#8ac926"); grad.addColorStop(1, "#1982c4");
    g.fillStyle = grad; g.fillRect(0, 0, 1200, 900);
    // some shapes so cuts are visible
    const rng = mulberry32(7);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `hsla(${(rng() * 360) | 0},80%,60%,0.85)`;
      g.beginPath();
      g.arc(rng() * 1200, rng() * 900, 40 + rng() * 120, 0, 7);
      g.fill();
    }
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.font = "bold 120px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("SAMPLE", 600, 450);
    g.font = "bold 44px system-ui";
    g.fillText("CUT ALONG THE LINES", 600, 560);
    state.img = c; state.imgName = "sample";
    els.dropzone.classList.add("has-img");
    clearDropzoneKeepInput();
    const im = document.createElement("img");
    im.src = c.toDataURL(); im.alt = "sample image";
    els.dropzone.appendChild(im);
    if (els.lockAspect && els.lockAspect.checked) {
      const aspect = 1200 / 900;
      const target = parseInt(els.targetPieces && els.targetPieces.value) || 64;
      const grid = calculateProportionalGrid(target, aspect);
      els.cols.value = grid.cols;
      els.rows.value = grid.rows;
    }
    regenerate();
  }

  // ---------- preview: assembled board with cut lines (native ratio) ----------
  function renderPreview() {
    const cv = els.preview;
    if (!state.img || !state.board) { cv.width = 0; cv.height = 0; return; }
    const { pieces, cellW, cellH, boardW, boardH } = state.board;
    const W = 1100;
    const H = Math.round((W * boardH) / boardW);
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    drawFull(ctx, 0, 0, W, H);
    const kx = W / boardW, ky = H / boardH; // uniform scale (same ratio)
    ctx.lineWidth = Math.max(1.5, W / 500);
    for (const p of pieces) {
      ctx.beginPath();
      p.outline.forEach(([px, py], i) => {
        const X = (p.cx * cellW + px) * kx, Y = (p.cy * cellH + (cellH - py)) * ky;
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = Math.max(1, W / 900);
      ctx.stroke();
      ctx.lineWidth = Math.max(1.5, W / 500);
    }
  }

  // ---------- print sheet: spaced individual pieces, then paper composition ----------
  function sheetParams(S, gap) {
    const { rows, cols, pieces, cellW, cellH } = state.board;
    const used = state.knobMode === "mix" ? state.templates
      : state.templates.filter((t) => t.id === state.knobMode);
    const eff = (t) => state.overrides[t.id] || t.controlPoints;
    const maxY = Math.max(0.2, ...used.flatMap((t) => eff(t).map((p) => p[1])));
    const tabSizeRatio = parseFloat(els.tabSize.value) || 0.2;
    const refLen = Math.min(cellW, cellH);
    // per-axis bleed: knob depth uses uniform refLen, so overhang is consistent across edges
    const pad = Math.ceil(tabSizeRatio * refLen * maxY) + 3;
    const padX = pad;
    const padY = pad;
    const strideX = cellW + padX * 2, strideY = cellH + padY * 2;
    const LW = gap * 2 + cols * strideX + (cols - 1) * gap;
    const LH = gap * 2 + rows * strideY + (rows - 1) * gap;
    return { rows, cols, pieces, padX, padY, strideX, strideY, LW: Math.round(LW), LH: Math.round(LH), S, gap };
  }

  // Draw the spaced-pieces block. White only when asked (no-paper mode);
  // on paper the block stays transparent and the paper provides the white.
  function renderLayout(ctx, sp, white) {
    const { rows, cols, pieces, padX, padY, strideX, strideY, gap } = sp;
    const { cellW, cellH, boardW, boardH } = state.board;
    if (white) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, sp.LW, sp.LH); }
    else ctx.clearRect(0, 0, sp.LW, sp.LH);
    for (const p of pieces) {
      const ox = gap + p.cx * (strideX + gap);
      const oy = gap + p.cy * (strideY + gap);
      ctx.save();
      ctx.beginPath();
      p.outline.forEach(([px, py], i) => {
        const X = ox + padX + px, Y = oy + padY + (cellH - py);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      });
      ctx.closePath();
      ctx.clip();
      // Draw the source so the piece's base rect lands exactly on its cell;
      // knob overhang then samples neighbour pixels, like textured-mesh UVs.
      ctx.drawImage(state.img, 0, 0, srcW(), srcH(),
        ox + padX - p.cx * cellW, oy + padY - p.cy * cellH, boardW, boardH);
      ctx.restore();
      if (els.cutLines.checked) {
        ctx.beginPath();
        p.outline.forEach(([px, py], i) => {
          const X = ox + padX + px, Y = oy + padY + (cellH - py);
          if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        });
        ctx.closePath();
        ctx.lineWidth = Math.max(1, sp.S / 200);
        ctx.strokeStyle = "#111";
        ctx.stroke();
      }
    }
  }

  // Compose the final sheet: pieces block alone, or placed on paper with
  // edge margin. Returns {canvas, note} where note describes the composition.
  function composeFinal(layout, sp) {
    const paperKey = els.paperSize.value;
    if (!PAPER_MM[paperKey]) {
      return { canvas: layout, note: `sheet ${sp.LW}x${sp.LH}px (no paper)` };
    }
    const dpi = parseInt(els.printDpi.value) || 300;
    const [mmW, mmH] = PAPER_MM[paperKey];
    const paperW = mmToPx(mmW, dpi), paperH = mmToPx(mmH, dpi);
    const margin = mmToPx(Math.max(0, parseFloat(els.edgeMargin.value) || 0), dpi);
    const pw = Math.max(1, paperW - margin * 2), ph = Math.max(1, paperH - margin * 2);
    let dw, dh;
    if (els.paperFit.value === "stretch") {
      dw = pw; dh = ph; // fill the printable area exactly
    } else {
      const k = Math.min(pw / sp.LW, ph / sp.LH); // fit, keep shape
      dw = sp.LW * k; dh = sp.LH * k;
    }
    const dx = margin + (pw - dw) / 2, dy = margin + (ph - dh) / 2;
    const paper = document.createElement("canvas");
    paper.width = paperW; paper.height = paperH;
    const ctx = paper.getContext("2d");
    ctx.fillStyle = "#ffffff"; // paper stock is always white
    ctx.fillRect(0, 0, paperW, paperH);
    ctx.drawImage(layout, 0, 0, sp.LW, sp.LH, dx, dy, dw, dh);
    const pct = Math.round((100 * dw) / sp.LW);
    const label = els.paperSize.options[els.paperSize.selectedIndex].text;
    return {
      canvas: paper,
      note: `${label} @${dpi}dpi (${paperW}x${paperH}px), margin ${els.edgeMargin.value}mm, pieces at ${pct}%`,
    };
  }

  function buildFinalSheet() {
    // returns {canvas, sp, note} or null + sets the too-large warning
    const S = parseInt(els.piecePx.value) || 300;
    const gap = parseInt(els.gapPx.value) || 0;
    const sp = sheetParams(S, gap);
    const layout = document.createElement("canvas");
    layout.width = sp.LW; layout.height = sp.LH;
    const paperKey = els.paperSize.value;
    if (paperKey === "none" && (sp.LW > 16384 || sp.LH > 16384 || sp.LW * sp.LH > 200_000_000)) {
      els.sheetInfo.textContent = `Sheet too large (${sp.LW}x${sp.LH}px). Reduce piece size or tiling.`;
      return null;
    }
    renderLayout(layout.getContext("2d"), sp, paperKey === "none" && els.bgWhite.checked);
    const { canvas, note } = composeFinal(layout, sp);
    if (canvas.width * canvas.height > 200_000_000 || canvas.width > 16384 || canvas.height > 16384) {
      els.sheetInfo.textContent = `Paper sheet too large (${canvas.width}x${canvas.height}px). Lower DPI or piece size.`;
      return null;
    }
    return { canvas, sp, note };
  }

  function renderSheetPreview() {
    const cv = els.sheetPreview;
    if (!state.img || !state.board) { cv.width = 0; cv.height = 0; return; }
    const built = buildFinalSheet();
    if (!built) return;
    const { canvas, sp, note } = built;
    const scale = Math.min(1, 1100 / canvas.width);
    cv.width = Math.max(1, Math.round(canvas.width * scale));
    cv.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(canvas, 0, 0, cv.width, cv.height);
    const n = sp.rows * sp.cols;
    els.sheetInfo.textContent =
      `${n} pieces, layout ${sp.LW}x${sp.LH}px, ${note}`;
  }

  // ---------- export ----------
  function download(canvas, filename) {
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }

  function baseName() {
    const { rows, cols, seed } = state.board;
    const knob = state.knobMode;
    return `jigsaw-${cols}x${rows}-${knob}-s${seed}`;
  }

  function exportSheet() {
    if (!state.img || !state.board) return;
    const built = buildFinalSheet();
    if (!built) return;
    const paperKey = els.paperSize.value;
    download(built.canvas, baseName() + (paperKey === "none" ? "-print.png" : `-paper-${paperKey}.png`));
  }

  function exportAssembled() {
    if (!state.img || !state.board) return;
    const { boardW, boardH } = state.board;
    const off = document.createElement("canvas");
    off.width = Math.round(boardW); off.height = Math.round(boardH);
    drawFull(off.getContext("2d"), 0, 0, off.width, off.height);
    download(off, baseName() + "-assembled.png");
  }

  // Picker thumbnails: tall template-space curve, filled silhouette.
  function drawKnobThumb(canvas, cp, color, W, H) {
    W = W || 300; H = H || 128;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const curve = sampleTemplateCurve(cp, 60);
    const padX = 10, baseY = H - 8, topPad = 6;
    const X = (t) => padX + t * (W - padX * 2);
    const Y = (v) => baseY - v * (baseY - topPad); // template space, y 0..1 fills the box
    // baseline
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(W, baseY); ctx.stroke();
    // filled shape
    ctx.beginPath();
    ctx.moveTo(X(0), baseY);
    for (const [tx, ty] of curve) ctx.lineTo(X(tx), Y(ty));
    ctx.lineTo(X(1), baseY);
    ctx.closePath();
    ctx.fillStyle = color || "#38bdf8";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  const KNOB_COLORS = ["#38bdf8", "#10b981", "#f59e0b", "#f43f5e", "#a855f7"];

  // Tune preview uses the EXACT same mapping as the picker thumbnails
  // (same box aspect 300:128, same paddings) so a profile looks identical
  // in both places, plus the control-point dots and index labels.
  var TUNE_W0 = 300, TUNE_H0 = 128;
  function drawTuneThumb() {
    const t = tunedTemplate();
    if (!t || !state.overrides[t.id]) return;
    if (els.tuneBody.style.display === "none") return;
    const pts = state.overrides[t.id];
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(240, Math.round(els.tuneCurve.clientWidth || 240));
    const h = Math.round((w * TUNE_H0) / TUNE_W0);
    const cv = els.tuneCurve;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#090a0f";
    ctx.fillRect(0, 0, w, h);
    const padX = (w * 10) / TUNE_W0, baseY = h - (h * 8) / TUNE_H0, topPad = (h * 6) / TUNE_H0;
    const X = (tx) => padX + tx * (w - padX * 2);
    const Y = (v) => baseY - v * (baseY - topPad); // template space, y 0..1, same as picker
    // baseline
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = Math.max(1.5, w / 150);
    ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(w, baseY); ctx.stroke();
    // smoothed curve
    const curve = sampleTemplateCurve(pts, 90);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = Math.max(2, w / 100);
    ctx.lineJoin = "round";
    ctx.beginPath();
    curve.forEach(([x, y], i) => {
      const px = X(x), py = Y(y);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    // control points with index labels
    const dotR = Math.max(3.5, w / 65);
    ctx.textAlign = "center";
    ctx.font = `${Math.max(10, Math.round(w / 26))}px 'JetBrains Mono', monospace`;
    pts.forEach(([x, y], i) => {
      const locked = i === 0 || i === pts.length - 1;
      const px = X(x), py = Y(y);
      ctx.beginPath();
      ctx.arc(px, py, locked ? dotR + 1 : dotR, 0, 7);
      ctx.fillStyle = locked ? "#ef4444" : "#f59e0b";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText(locked ? `[${i}] lock` : `[${i}]`, px, py - dotR - 7);
    });
  }

  function buildKnobPicker() {
    els.knobList.innerHTML = "";
    els.knobList.removeAttribute("aria-busy");
    els.knobList.removeAttribute("aria-label");
    const mkItem = (id, name, cpOrNull, sub, color) => {
      const b = document.createElement("button");
      b.type = "button";
      const isMix = !cpOrNull;
      b.className = "list-group-item " + (isMix ? "mix-row" : "profile-card") +
        (state.knobMode === id ? " active" : "");
      b.title = sub || name;
      const c = document.createElement("canvas");
      if (cpOrNull) {
        drawKnobThumb(c, cpOrNull, color);
      } else {
        // mix icon: grey chip with MIX stamped on it (2x coords for 300x128)
        const dpr = window.devicePixelRatio || 1;
        c.width = 300 * dpr; c.height = 128 * dpr;
        const ctx = c.getContext("2d");
        ctx.scale(dpr, dpr);
        ctx.fillStyle = "#eeeeee";
        ctx.strokeStyle = "#333333";
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(56, 24, 188, 80, 12);
        else ctx.rect(56, 24, 188, 80);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#333333";
        ctx.font = "700 40px Helvetica, Arial, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("MIX", 150, 68);
      }
      const s = document.createElement("span");
      s.textContent = name;
      b.appendChild(c);
      b.appendChild(s);
      b.addEventListener("click", () => {
        state.knobMode = id;
        els.knobList.querySelectorAll(".list-group-item").forEach((el) => el.classList.remove("active"));
        b.classList.add("active");
        refreshTune();
        regenerate();
      });
      els.knobList.appendChild(b);
    };
    mkItem("mix", "Mix them up", null, "Random profile per cut edge");
    state.templates.forEach((t, i) => mkItem(t.id, t.name, t.controlPoints, t.description, KNOB_COLORS[i % KNOB_COLORS.length]));
  }

  // ---------- runtime tune (unsaved overrides + optional save to DB) ----------
  function tunedTemplate() {
    if (state.knobMode === "mix") return null;
    return state.templates.find((t) => t.id === state.knobMode) || null;
  }

  function refreshTune() {
    const t = tunedTemplate();
    if (!t) {
      els.tuneBody.style.display = "none";
      els.tuneNote.textContent = "Select a single profile above to tune its points at runtime (mix mode can't be tuned).";
      return;
    }
    els.tuneBody.style.display = "";
    els.tuneNote.textContent = "Runtime only, same scaling as the picker, with control-point dots. Tuned points apply instantly and are lost on reload unless requested.";
    if (!state.overrides[t.id]) state.overrides[t.id] = t.controlPoints.map((p) => [...p]);
    if (!els.tuneName.value) els.tuneName.value = `${t.name} tuned`;
    renderTuneList(t);
    drawTuneThumb();
    els.tuneSaveBtn.disabled = !state.dbUp;
    const dirty = JSON.stringify(state.overrides[t.id]) !== JSON.stringify(t.controlPoints);
    els.tuneMsg.textContent = state.dbUp
      ? (dirty ? "Tuned, previews use your points. Request stores a copy as a new profile." : "")
      : "Unreachable. Tuning works, but requesting needs the connection.";
  }

  function renderTuneList(t) {
    els.tuneList.innerHTML = "";
    const pts = state.overrides[t.id];
    pts.forEach(([x, y], i) => {
      const locked = i === 0 || i === pts.length - 1;
      const li = document.createElement("li");
      li.className = "point-row";
      const xi = document.createElement("input");
      xi.type = "number"; xi.step = "0.01"; xi.min = "0"; xi.max = "1"; xi.value = x;
      xi.disabled = locked;
      xi.addEventListener("change", () => {
        pts[i][0] = Math.round(Math.min(1, Math.max(0, parseFloat(xi.value) || 0)) * 100) / 100;
        xi.value = pts[i][0];
        drawTuneThumb();
        regenerate();
      });
      const yi = document.createElement("input");
      yi.type = "number"; yi.step = "0.01"; yi.min = "0"; yi.max = "1.2"; yi.value = y;
      yi.disabled = locked;
      yi.addEventListener("change", () => {
        pts[i][1] = Math.round(Math.min(1.2, Math.max(0, parseFloat(yi.value) || 0)) * 100) / 100;
        yi.value = pts[i][1];
        drawTuneThumb();
        regenerate();
      });
      li.appendChild(document.createTextNode(" "));
      li.appendChild(xi);
      li.appendChild(document.createTextNode(" "));
      li.appendChild(yi);
      if (locked) {
        const l = document.createElement("span");
        l.className = "lock";
        l.textContent = "locked";
        li.appendChild(l);
      }
      els.tuneList.appendChild(li);
    });
  }

  async function tuneSave() {
    const t = tunedTemplate();
    if (!t || !state.dbUp) return;
    const name = els.tuneName.value.trim();
    if (!name) { els.tuneMsg.textContent = "Give the tuned copy a name first."; return; }
    els.tuneSaveBtn.disabled = true;
    try {
      const json = await window.JigsawAPI.call("knobs", "create", {
        method: "POST",
        body: {
          name, description: `Tuned copy of ${t.name}.`,
          control_points: state.overrides[t.id],
        },
      });
      delete state.overrides[t.id];
      els.tuneName.value = "";
      await loadTemplates();
      state.knobMode = json.data.slug;
      buildKnobPicker();
      refreshTune();
      regenerate();
      els.tuneMsg.textContent = `Saved as "${json.data.name}".`;
    } catch (e) {
      els.tuneMsg.textContent = "Save failed: " + e.message;
      els.tuneSaveBtn.disabled = !state.dbUp;
    }
  }

  // ---------- main ----------
  function cellDims(cols, rows, S) {
    // Board keeps the image's actual ratio: columns are S px wide,
    // total height follows the image, rows split it (cells may be non-square).
    if (!state.img) return { cellW: S, cellH: S };
    const boardW = cols * S;
    return { cellW: S, cellH: (boardW * srcH()) / srcW() / rows };
  }

  function regenerate() {
    if (!state.templates.length) return;
    const cols = Math.min(30, Math.max(1, parseInt(els.cols.value) || 4));
    const rows = Math.min(30, Math.max(1, parseInt(els.rows.value) || 3));
    const seed = parseInt(els.seed.value) || 0;
    const S = parseInt(els.piecePx.value) || 300;
    els.tabSizeVal.textContent = (parseFloat(els.tabSize.value) || 0.2).toFixed(2);
    const { cellW, cellH } = cellDims(cols, rows, S);
    state.board = generateBoard(seed >>> 0, rows, cols, cellW, cellH);
    const hasPaper = !!PAPER_MM[els.paperSize.value];
    els.printDpi.disabled = !hasPaper;
    els.edgeMargin.disabled = !hasPaper;
    els.paperFit.disabled = !hasPaper;
    if (state.img) {
      const ratio = cellW / cellH;
      const isSquare = ratio >= 0.92 && ratio <= 1.08;
      const ratioLabel = isSquare ? "Square (1:1)" : `${ratio.toFixed(2)}:1 ${ratio > 1 ? "wide" : "tall"}`;
      els.imgInfo.innerHTML =
        `${state.imgName} ${srcW()}x${srcH()}px actual size. Board ${cols}x${rows} ` +
        `(${state.board.pieces.length} pieces, cell ${Math.round(cellW)}x${Math.round(cellH)}px &bull; <span class="${isSquare ? 'badge-square' : 'badge-rect'}">${ratioLabel}</span>)`;
      renderPreview();
      renderSheetPreview();
      drawTuneThumb(); // depth slider changes the true-scale preview height
    } else {
      els.imgInfo.textContent = "No image yet. Upload one or use the sample.";
    }
    const has = !!(state.img && state.board);
    els.exportSheetBtn.disabled = !has;
    els.exportAssembledBtn.disabled = !has;
  }

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  async function loadTemplates() {
    // Supabase first, local PHP second, built-in defaults last.
    try {
      const json = await window.JigsawAPI.call("knobs", "list");
      if (!json.data || !json.data.length) throw new Error("empty catalog");
      state.templates = json.data.map((r) => ({
        id: r.slug, name: r.name,
        description: r.description || "",
        controlPoints: r.controlPoints,
      }));
      state.dbUp = true;
      const where = window.JigsawAPI.usedBase === "supabase" ? "supabase connected" : "local connected";
      els.knobSource.textContent = `Catalog: ${where} (${state.templates.length} profiles).`;
    } catch (err) {
      const res = await fetch("../assets/json/knobs.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.templates = data.templates;
      state.dbUp = false;
      els.knobSource.textContent = `Catalog: default presets.`;
    }
  }

  async function init() {
    const regenSoon = debounce(regenerate, 250);

    function applyTargetGrid() {
      if (!state.img) return;
      const aspect = srcW() / srcH();
      const target = parseInt(els.targetPieces?.value) || 64;
      const grid = calculateProportionalGrid(target, aspect);
      els.cols.value = grid.cols;
      els.rows.value = grid.rows;
      regenerate();
    }
    if (els.calcGridBtn) els.calcGridBtn.addEventListener("click", applyTargetGrid);
    if (els.targetPieces) els.targetPieces.addEventListener("change", applyTargetGrid);

    els.cols.addEventListener("input", () => {
      if (els.lockAspect && els.lockAspect.checked && state.img) {
        const aspect = srcW() / srcH();
        const c = Math.max(1, Math.min(30, parseInt(els.cols.value) || 1));
        const r = Math.max(1, Math.min(30, Math.round(c / aspect)));
        els.rows.value = r;
        if (els.targetPieces) els.targetPieces.value = c * r;
      }
      regenerate();
    });

    els.rows.addEventListener("input", () => {
      if (els.lockAspect && els.lockAspect.checked && state.img) {
        const aspect = srcW() / srcH();
        const r = Math.max(1, Math.min(30, parseInt(els.rows.value) || 1));
        const c = Math.max(1, Math.min(30, Math.round(r * aspect)));
        els.cols.value = c;
        if (els.targetPieces) els.targetPieces.value = c * r;
      }
      regenerate();
    });

    if (els.lockAspect) {
      els.lockAspect.addEventListener("change", () => {
        if (els.lockAspect.checked && state.img) {
          const aspect = srcW() / srcH();
          const target = parseInt(els.targetPieces?.value) || ((parseInt(els.cols.value) || 8) * (parseInt(els.rows.value) || 5)) || 64;
          const grid = calculateProportionalGrid(target, aspect);
          els.cols.value = grid.cols;
          els.rows.value = grid.rows;
        }
        regenerate();
      });
    }

    ["seed", "tabSize", "piecePx", "gapPx", "edgeMargin"].forEach((id) => {
      els[id].addEventListener("input", id === "tabSize" || id === "piecePx" || id === "gapPx" || id === "edgeMargin" ? regenSoon : regenerate);
    });
    ["paperSize", "printDpi", "paperFit"].forEach((id) => {
      els[id].addEventListener("change", regenerate);
    });
    els.bgWhite.addEventListener("change", regenerate);
    els.cutLines.addEventListener("change", regenerate);
    els.shuffleBtn.addEventListener("click", () => {
      els.seed.value = (Math.random() * 1e9) | 0;
      regenerate();
    });
    els.sampleBtn.addEventListener("click", makeSampleImage);
    els.exportSheetBtn.addEventListener("click", exportSheet);
    els.exportAssembledBtn.addEventListener("click", exportAssembled);
    els.tuneResetBtn.addEventListener("click", () => {
      const t = tunedTemplate();
      if (!t) return;
      delete state.overrides[t.id];
      els.tuneName.value = "";
      refreshTune();
      regenerate();
    });
    els.tuneSaveBtn.addEventListener("click", tuneSave);
    window.addEventListener("resize", debounce(() => {
      if (els.tuneBody.style.display !== "none") drawTuneThumb();
    }, 200));

    els.dropzone.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", (e) => loadFile(e.target.files[0]));
    ["dragover", "dragenter"].forEach((ev) => els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); els.dropzone.classList.add("dragover");
    }));
    ["dragleave", "drop"].forEach((ev) => els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); els.dropzone.classList.remove("dragover");
    }));
    els.dropzone.addEventListener("drop", (e) => loadFile(e.dataTransfer.files[0]));
    els.dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") els.fileInput.click();
    });

    try {
      await loadTemplates();
    } catch (err) {
      els.knobList.innerHTML =
        `<span class="list-group-item">Could not load knob profiles (${err.message}). Serve this folder over http (e.g. XAMPP) instead of file://.</span>`;
      els.knobList.removeAttribute("aria-busy");
      return;
    }
    buildKnobPicker();
    refreshTune();
    regenerate();
  }

  init();
})();

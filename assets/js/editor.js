/* Edge editor: design knob profiles in the browser, stored in the catalog.
 * Requires the database: without it the whole form stays disabled (greyed).
 * Curve math is the same Catmull-Rom the cutter uses (see create.js).
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    dbAlert: $("dbAlert"), form: $("editorForm"),
    profileSelect: $("profileSelect"), newBtn: $("newBtn"), builtinNote: $("builtinNote"),
    fldName: $("fldName"), fldSlug: $("fldSlug"), fldDesc: $("fldDesc"),
    saveBtn: $("saveBtn"), resetBtn: $("resetBtn"), deleteBtn: $("deleteBtn"),
    saveAlert: $("saveAlert"),
    addPointBtn: $("addPointBtn"), delPointBtn: $("delPointBtn"), pointList: $("pointList"),
    curve: $("curveCanvas"), piece: $("pieceCanvas"),
  };

  const state = {
    profiles: [],
    cur: null,      // {id, slug, name, description, points, isBuiltin, pristine}
    sel: -1,        // selected point index
    drag: -1,       // dragging point index
  };

  const NEW_POINTS = [[0, 0], [0.35, 0], [0.5, 0.8], [0.65, 0], [1, 0]];
  const YMAX = 1.2;

  // ---------- Catmull-Rom (same formula as the cutter) ----------
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

  function sampleCurve(cp, samples) {
    const out = [];
    const segs = cp.length - 1;
    for (let s = 0; s <= samples; s++) {
      const gt = (s / samples) * segs;
      const i = Math.min(Math.floor(gt), segs - 1);
      out.push(catmullRomPoint(cp, i, gt - i));
    }
    return out;
  }

  function appendEdge(pts, start, end, type, cp, tabSizeRatio, resolution) {
    if (type === "flat") { pts.push(start); return; }
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const len = Math.hypot(dx, dy);
    const dir = [dx / len, dy / len];
    const normal = [-dir[1], dir[0]];
    const tabDepth = tabSizeRatio * len;
    const direction = type === "tab" ? 1 : -1;
    const ctrl = cp.map(([tx, ty]) => [
      start[0] + (end[0] - start[0]) * tx + normal[0] * ty * tabDepth * direction,
      start[1] + (end[1] - start[1]) * tx + normal[1] * ty * tabDepth * direction,
    ]);
    for (let i = 0; i < ctrl.length - 1; i++) {
      for (let s = 0; s < resolution; s++) {
        pts.push(catmullRomPoint(ctrl, i, s / resolution));
      }
    }
  }

  // ---------- curve canvas mapping ----------
  const PAD = { l: 44, r: 16, t: 16, b: 44 };
  function plotW() { return els.curve.width - PAD.l - PAD.r; }
  function plotH() { return els.curve.height - PAD.t - PAD.b; }
  function toPx([x, y]) {
    return [PAD.l + x * plotW(), PAD.t + (1 - y / YMAX) * plotH()];
  }
  function fromPx(px, py) {
    const r = els.curve.getBoundingClientRect();
    const sx = els.curve.width / r.width, sy = els.curve.height / r.height;
    const cx = (px - r.left) * sx, cy = (py - r.top) * sy;
    const x = Math.min(1, Math.max(0, (cx - PAD.l) / plotW()));
    const y = Math.min(YMAX, Math.max(0, YMAX * (1 - (cy - PAD.t) / plotH())));
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  }

  function renderCurve() {
    const ctx = els.curve.getContext("2d");
    const cp = state.cur.points;
    ctx.clearRect(0, 0, els.curve.width, els.curve.height);
    // grid
    ctx.strokeStyle = "#e5e5e5";
    ctx.fillStyle = "#777";
    ctx.font = "12px Helvetica, Arial, sans-serif";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 6; g++) {
      const yv = (YMAX / 6) * g;
      const [, py] = toPx([0, yv]);
      ctx.beginPath(); ctx.moveTo(PAD.l, py); ctx.lineTo(PAD.l + plotW(), py); ctx.stroke();
      ctx.fillText(yv.toFixed(1), 8, py + 4);
    }
    for (let g = 0; g <= 10; g++) {
      const [px] = toPx([g / 10, 0]);
      ctx.beginPath(); ctx.moveTo(px, PAD.t); ctx.lineTo(px, PAD.t + plotH()); ctx.stroke();
      if (g % 2 === 0) ctx.fillText((g / 10).toFixed(1), px - 8, PAD.t + plotH() + 18);
    }
    // baseline
    const [, by] = toPx([0, 0]);
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD.l, by); ctx.lineTo(PAD.l + plotW(), by); ctx.stroke();
    if (cp.length >= 2) {
      // smooth curve
      const curve = sampleCurve(cp, 90);
      ctx.strokeStyle = "#337ab7";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.beginPath();
      curve.forEach(([x, y], i) => {
        const [px, py] = toPx([x, Math.min(YMAX, Math.max(0, y))]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      // control points
      cp.forEach(([x, y], i) => {
        const [px, py] = toPx([x, y]);
        const locked = i === 0 || i === cp.length - 1;
        ctx.beginPath();
        ctx.arc(px, py, i === state.sel ? 9 : 7, 0, 7);
        ctx.fillStyle = locked ? "#d9534f" : i === state.sel ? "#f0ad4e" : "#337ab7";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        ctx.fillStyle = "#333";
        ctx.fillText("[" + i + "]", px + 10, py - 8);
      });
    }
  }

  // ---------- piece preview: one test piece with this profile on all edges ----------
  function renderPiece() {
    const cv = els.piece, ctx = cv.getContext("2d");
    const cp = state.cur.points;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (cp.length < 3) {
      ctx.fillStyle = "#777";
      ctx.font = "14px Helvetica, Arial, sans-serif";
      ctx.fillText("Need at least 3 points for a preview.", 40, 170);
      return;
    }
    const cell = 190, ox = (cv.width - cell) / 2, oy = (cv.height - cell) / 2;
    const pts = [];
    appendEdge(pts, [0, cell], [cell, cell], "tab", cp, 0.2, 8);
    appendEdge(pts, [cell, cell], [cell, 0], "tab", cp, 0.2, 8);
    appendEdge(pts, [cell, 0], [0, 0], "blank", cp, 0.2, 8);
    appendEdge(pts, [0, 0], [0, cell], "blank", cp, 0.2, 8);
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const X = ox + px, Y = oy + (cell - py);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(51,122,183,0.25)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#222";
    ctx.stroke();
  }

  function renderAll() { renderCurve(); renderPiece(); }

  // ---------- point list ----------
  function renderPointList() {
    els.pointList.innerHTML = "";
    state.cur.points.forEach(([x, y], i) => {
      const locked = i === 0 || i === state.cur.points.length - 1;
      const li = document.createElement("li");
      li.className = "point-row" + (i === state.sel ? " selected" : "");
      const xi = document.createElement("input");
      xi.type = "number"; xi.step = "0.01"; xi.min = "0"; xi.max = "1"; xi.value = x;
      xi.disabled = locked;
      xi.addEventListener("change", () => {
        const v = Math.min(1, Math.max(0, parseFloat(xi.value) || 0));
        state.cur.points[i][0] = Math.round(v * 100) / 100;
        xi.value = state.cur.points[i][0];
        renderAll();
      });
      const yi = document.createElement("input");
      yi.type = "number"; yi.step = "0.01"; yi.min = "0"; yi.max = String(YMAX); yi.value = y;
      yi.disabled = locked;
      yi.addEventListener("change", () => {
        const v = Math.min(YMAX, Math.max(0, parseFloat(yi.value) || 0));
        state.cur.points[i][1] = Math.round(v * 100) / 100;
        yi.value = state.cur.points[i][1];
        renderAll();
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
      li.addEventListener("click", () => { state.sel = i; renderAll(); renderPointList(); });
      els.pointList.appendChild(li);
      // "Add before / after" live on the row itself (hover), never separate
      // list items, so numbering can't break. Anchors keep their lock:
      // no "before" on the first row, no "after" on the last.
      const mkAdd = (label, at, title) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-default btn-xs row-add-btn";
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const cp = state.cur.points;
          const a = cp[at - 1], b = cp[at];
          const mid = (u, v) => Math.round(((u + v) / 2) * 100) / 100;
          cp.splice(at, 0, [mid(a[0], b[0]), mid(a[1], b[1])]);
          state.sel = at;
          renderAll(); renderPointList();
        });
        li.appendChild(btn);
      };
      if (i > 0) mkAdd("+↑", i, `Add point above (between #${i} and #${i + 1})`);
      if (i < state.cur.points.length - 1) mkAdd("+↓", i + 1, `Add point below (between #${i + 1} and #${i + 2})`);
    });
  }

  // ---------- current profile <-> form ----------
  function blankProfile() {
    return {
      id: null, slug: "", name: "Untitled knob", description: "",
      points: NEW_POINTS.map((p) => [...p]), isBuiltin: false,
      pristine: null,
    };
  }

  function loadIntoForm(p) {
    state.cur = {
      id: p.id, slug: p.slug, name: p.name, description: p.description || "",
      points: p.controlPoints.map((pt) => [pt[0], pt[1]]),
      isBuiltin: !!p.isBuiltin,
      pristine: JSON.stringify(p.controlPoints),
    };
    state.sel = -1;
    els.fldName.value = state.cur.name;
    els.fldSlug.value = state.cur.slug;
    els.fldDesc.value = state.cur.description;
    els.fldSlug.disabled = state.cur.id !== null; // slug editable only for new profiles
    els.deleteBtn.disabled = state.cur.id === null || state.cur.isBuiltin;
    els.builtinNote.textContent = state.cur.isBuiltin
      ? "Built-in profile: you can tweak and save it, but it cannot be deleted or re-slugged."
      : state.cur.id === null
        ? "New profile: slug is generated from the name, editable until first save."
        : "Custom profile: everything editable, can be deleted.";
    renderPointList();
    renderAll();
  }

  function readForm() {
    state.cur.name = els.fldName.value.trim();
    state.cur.description = els.fldDesc.value.trim();
    if (state.cur.id === null) {
      const typed = els.fldSlug.value.trim();
      state.cur.slug = typed || els.fldName.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      els.fldSlug.value = state.cur.slug;
    }
  }

  function localValidate() {
    if (!state.cur.name) return "Name is required.";
    if (state.cur.id === null && !/^[a-z0-9_]{2,32}$/.test(state.cur.slug)) {
      return "Slug must be 2-32 chars: lowercase letters, digits, underscore.";
    }
    if (state.cur.points.length < 3) return "Need at least 3 control points.";
    const f = state.cur.points[0], l = state.cur.points[state.cur.points.length - 1];
    if (Math.abs(f[0]) > 0.001 || Math.abs(f[1]) > 0.001) return "First point must be [0, 0].";
    if (Math.abs(l[0] - 1) > 0.001 || Math.abs(l[1]) > 0.001) return "Last point must be [1, 0].";
    return null;
  }

  function alert(html, kind) {
    els.saveAlert.innerHTML = `<div class="alert alert-${kind}">${html}</div>`;
  }

  async function api(action, payload, isGet) {
    return window.JigsawAPI.call("knobs", action, isGet
      ? { query: payload && payload.id ? `&id=${payload.id}` : "" }
      : { method: "POST", body: payload || {} });
  }

  async function refreshProfiles(selectId) {
    const { data: rows } = await api("list", null, true);
    state.profiles = rows;
    els.profileSelect.innerHTML = "";
    const optNew = document.createElement("option");
    optNew.value = "__new__";
    optNew.textContent = "+ New profile...";
    els.profileSelect.appendChild(optNew);
    rows.forEach((r) => {
      const o = document.createElement("option");
      o.value = String(r.id);
      o.textContent = `${r.name}${r.isBuiltin ? " (built-in)" : ""}`;
      els.profileSelect.appendChild(o);
    });
    const target = selectId !== undefined ? String(selectId)
      : rows.length ? String(rows[0].id) : "__new__";
    els.profileSelect.value = target;
    if (target === "__new__") loadIntoForm({ id: null, slug: "", name: "Untitled knob", description: "", controlPoints: NEW_POINTS, isBuiltin: false });
    else {
      const r = rows.find((x) => String(x.id) === target);
      loadIntoForm(r);
    }
  }

  // ---------- events ----------
  function hitTest(mx, my) {
    // mx,my in css px relative to canvas
    const r = els.curve.getBoundingClientRect();
    const sx = els.curve.width / r.width, sy = els.curve.height / r.height;
    let best = -1, bestD = 16 * Math.max(sx, sy);
    state.cur.points.forEach(([x, y], i) => {
      const [px, py] = toPx([x, y]);
      const d = Math.hypot(px - mx * sx, py - my * sy);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function canvasPos(e) {
    const r = els.curve.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  els.curve.addEventListener("pointerdown", (e) => {
    if (els.form.disabled) return;
    const [mx, my] = canvasPos(e);
    const hit = hitTest(mx, my);
    state.sel = hit;
    if (hit >= 0 && hit !== 0 && hit !== state.cur.points.length - 1) {
      state.drag = hit;
      els.curve.setPointerCapture(e.pointerId);
    }
    renderAll(); renderPointList();
  });
  els.curve.addEventListener("pointermove", (e) => {
    if (state.drag < 0) return;
    const [x, y] = fromPx(e.clientX, e.clientY);
    state.cur.points[state.drag] = [x, y];
    renderAll();
  });
  els.curve.addEventListener("pointerup", () => {
    state.drag = -1;
    renderPointList();
  });
  els.curve.addEventListener("dblclick", (e) => {
    if (els.form.disabled) return;
    const [x, y] = fromPx(e.clientX, e.clientY);
    // insert after the nearest segment
    const cp = state.cur.points;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < cp.length - 1; i++) {
      const d = Math.hypot((cp[i][0] + cp[i + 1][0]) / 2 - x, (cp[i][1] + cp[i + 1][1]) / 2 - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    cp.splice(best + 1, 0, [x, y]);
    state.sel = best + 1;
    renderAll(); renderPointList();
  });

  els.addPointBtn.addEventListener("click", () => {
    const cp = state.cur.points;
    // Quick append before the locked end point (midpoint of the last segment).
    const at = cp.length - 1;
    const a = cp[at - 1], b = cp[at];
    const mid = (u, v) => Math.round(((u + v) / 2) * 100) / 100;
    cp.splice(at, 0, [mid(a[0], b[0]), mid(a[1], b[1])]);
    state.sel = at;
    renderAll(); renderPointList();
  });
  els.delPointBtn.addEventListener("click", () => {
    const cp = state.cur.points;
    if (state.sel <= 0 || state.sel >= cp.length - 1) { alert("Select a middle point to delete (endpoints are locked).", "info"); return; }
    if (cp.length <= 3) { alert("A profile needs at least 3 points.", "info"); return; }
    cp.splice(state.sel, 1);
    state.sel = -1;
    renderAll(); renderPointList();
  });

  els.fldName.addEventListener("input", () => {
    if (state.cur && state.cur.id === null) {
      els.fldSlug.value = els.fldName.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    }
  });

  els.profileSelect.addEventListener("change", () => {
    const v = els.profileSelect.value;
    if (v === "__new__") {
      loadIntoForm({ id: null, slug: "", name: "Untitled knob", description: "", controlPoints: NEW_POINTS, isBuiltin: false });
    } else {
      const r = state.profiles.find((x) => String(x.id) === v);
      if (r) loadIntoForm(r);
    }
    els.saveAlert.innerHTML = "";
  });
  els.newBtn.addEventListener("click", () => {
    els.profileSelect.value = "__new__";
    loadIntoForm({ id: null, slug: "", name: "Untitled knob", description: "", controlPoints: NEW_POINTS, isBuiltin: false });
    els.saveAlert.innerHTML = "";
  });
  els.resetBtn.addEventListener("click", () => {
    if (state.cur.id === null) {
      loadIntoForm({ id: null, slug: "", name: "Untitled knob", description: "", controlPoints: NEW_POINTS, isBuiltin: false });
    } else {
      const r = state.profiles.find((x) => x.id === state.cur.id);
      if (r) loadIntoForm(r);
    }
    els.saveAlert.innerHTML = "";
  });

  els.saveBtn.addEventListener("click", async () => {
    readForm();
    const err = localValidate();
    if (err) { alert(err, "info"); return; }
    els.saveBtn.disabled = true;
    try {
      let r;
      if (state.cur.id === null) {
        r = await api("create", {
          slug: state.cur.slug, name: state.cur.name,
          description: state.cur.description, control_points: state.cur.points,
        });
      } else {
        r = await api("update", {
          id: state.cur.id, name: state.cur.name,
          description: state.cur.description, control_points: state.cur.points,
        });
      }
      await refreshProfiles(r.data.id);
      alert(`Saved <b>${r.data.name}</b> (${r.data.slug}). The create page picks it up immediately.`, "success");
    } catch (e) {
      alert(e.message, "danger");
    }
    els.saveBtn.disabled = false;
  });

  els.deleteBtn.addEventListener("click", async () => {
    if (state.cur.id === null || state.cur.isBuiltin) return;
    if (!window.confirm(`Delete profile "${state.cur.name}"? This cannot be undone.`)) return;
    try {
      await api("delete", { id: state.cur.id });
      await refreshProfiles();
      alert("Profile deleted.", "success");
    } catch (e) {
      alert(e.message, "danger");
    }
  });

  // ---------- boot: grey out everything unless a backend answers ----------
  async function init() {
    let health = null;
    try {
      health = await window.JigsawAPI.call("status", "status", {});
    } catch (e) { health = null; }
    if (!health || !health.db) {
      els.dbAlert.innerHTML =
        '<div class="alert alert-danger" style="margin:0">No connection. The editor is greyed out. ' +
        'Check that the API is deployed and reachable, then reload this page. ' +
        'The create page keeps working with the default presets in the meantime.</div>';
      return; // fieldset stays disabled
    }
    try {
      await refreshProfiles();
      els.form.disabled = false;
    } catch (e) {
      els.dbAlert.innerHTML = `<div class="alert alert-danger" style="margin:0">Could not load profiles: ${e.message}</div>`;
    }
  }

  init();
})();

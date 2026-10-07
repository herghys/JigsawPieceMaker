window.JigsawAPI = (function () {
  function isProduction() {
    const e = String(window.JIGSAW_ENV || "").toLowerCase();
    if (e === "production" || e === "prod") return true;
    if (e === "development" || e === "dev" || e === "local") return false;
    try {
      const h = window.location.hostname || "";
      if (h === "" || h === "localhost" || h === "127.0.0.1" || h === "[::1]") return false;
    } catch (_) {}
    return true;
  }

  function supa() {
    const url = String(window.JIGSAW_SUPABASE_URL || "").replace(/\/$/, "");
    const key = window.JIGSAW_SUPABASE_ANON_KEY || "";
    if (!url || !key) return null;
    return { url: url + "/rest/v1", key };
  }

  function sHeaders(key, extra) {
    const h = { apikey: key, Authorization: "Bearer " + key };
    if (extra) for (const k in extra) h[k] = extra[k];
    return h;
  }

  function profileFromRow(r) {
    let cp = r.control_points;
    if (typeof cp === "string") {
      try { cp = JSON.parse(cp); } catch (_) { cp = []; }
    }
    return {
      id: r.id, slug: r.slug, name: r.name,
      description: r.description || "",
      controlPoints: cp || [],
      isBuiltin: !!r.is_builtin,
    };
  }

  function checkName(name) {
    if (!name || name.length > 80) throw new Error("Name is required (max 80 chars).");
  }
  function checkSlug(slug) {
    if (typeof slug !== "string" || !/^[a-z0-9_]{2,32}$/.test(slug)) {
      throw new Error("Slug must be 2-32 chars: lowercase letters, digits, underscore.");
    }
  }
  function checkPoints(cp) {
    if (!Array.isArray(cp) || cp.length < 3) throw new Error("Need at least 3 control points.");
    for (const p of cp) {
      if (!Array.isArray(p) || p.length !== 2 || !isFinite(p[0]) || !isFinite(p[1])) {
        throw new Error("Each control point must be [x, y] numbers.");
      }
    }
    if (Math.abs(cp[0][0]) > 0.001 || Math.abs(cp[0][1]) > 0.001) {
      throw new Error("First point must be [0, 0].");
    }
    const l = cp[cp.length - 1];
    if (Math.abs(l[0] - 1) > 0.001 || Math.abs(l[1]) > 0.001) {
      throw new Error("Last point must be [1, 0].");
    }
  }

  const SEL = "select=id,slug,name,description,control_points,is_builtin";

  async function supabaseCall(action, opts) {
    const s = supa();
    const { method = "GET", body = null, query = "" } = opts || {};
    async function req(path, init) {
      const res = await fetch(s.url + path, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) throw new Error("Slug already exists.");
        throw new Error((json && (json.message || json.error)) || ("HTTP " + res.status));
      }
      return json;
    }
    const get = (path) => req(path, { headers: sHeaders(s.key) });
    const write = (path, data) => req(path, {
      method: data ? "PATCH" : "DELETE",
      headers: sHeaders(s.key, data ? { "Content-Type": "application/json", Prefer: "return=representation" } : null),
      body: data ? JSON.stringify(data) : null,
    });

    if (action === "status") {
      await get("/knob_profiles?select=id&limit=1");
      return { ok: true, db: true };
    }
    if (method === "GET" && action === "list") {
      const rows = await get("/knob_profiles?" + SEL + "&order=is_builtin.desc&order=id.asc");
      return { ok: true, data: rows.map(profileFromRow) };
    }
    if (method === "GET" && action === "get") {
      const m = /id=(\d+)/.exec(query || "");
      const rows = await get("/knob_profiles?" + SEL + "&id=eq." + (m ? m[1] : "0"));
      if (!rows.length) throw new Error("Not found.");
      return { ok: true, data: profileFromRow(rows[0]) };
    }
    if (method === "POST" && action === "create") {
      const name = String((body && body.name) || "").trim();
      checkName(name);
      const slug = String((body && body.slug) || "").trim() ||
        name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      checkSlug(slug);
      const cp = (body && (body.control_points || body.controlPoints)) || null;
      checkPoints(cp);
      const rows = await req("/knob_profiles?" + SEL, {
        method: "POST",
        headers: sHeaders(s.key, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify({
          slug, name,
          description: String((body && body.description) || "").slice(0, 255),
          control_points: JSON.stringify(cp),
        }),
      });
      return { ok: true, data: profileFromRow(rows[0]) };
    }
    if (method === "POST" && action === "update") {
      const id = parseInt(body && body.id, 10) || 0;
      const cur = await get("/knob_profiles?select=id,is_builtin&id=eq." + id);
      if (!cur.length) throw new Error("Not found.");
      const patch = {};
      if (body && body.name !== undefined) {
        const name = String(body.name).trim();
        checkName(name);
        patch.name = name;
      }
      if (body && body.description !== undefined) {
        patch.description = String(body.description).slice(0, 255);
      }
      if (body && (body.control_points !== undefined || body.controlPoints !== undefined)) {
        const cp = body.control_points !== undefined ? body.control_points : body.controlPoints;
        checkPoints(cp);
        patch.control_points = JSON.stringify(cp);
      }
      if (body && body.slug !== undefined && !cur[0].is_builtin) {
        checkSlug(body.slug);
        patch.slug = body.slug;
      }
      if (!Object.keys(patch).length) throw new Error("Nothing to update.");
      const rows = await write("/knob_profiles?" + SEL + "&id=eq." + id, patch);
      return { ok: true, data: profileFromRow(rows[0]) };
    }
    if (method === "POST" && action === "delete") {
      const id = parseInt(body && body.id, 10) || 0;
      const cur = await get("/knob_profiles?select=id,is_builtin&id=eq." + id);
      if (!cur.length) throw new Error("Not found.");
      if (cur[0].is_builtin) throw new Error("Built-in profiles cannot be deleted.");
      await write("/knob_profiles?id=eq." + id, null);
      return { ok: true, data: { id } };
    }
    throw new Error("Unknown action.");
  }

  async function localCall(base, action, opts) {
    const { method = "GET", body = null, query = "" } = opts || {};
    const res = await fetch(
      `${base}?action=${action}${query || ""}`,
      method === "GET"
        ? { cache: "no-store" }
        : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error((json && json.error) || ("HTTP " + res.status));
    return json;
  }

  function legacyUrl(base, route, action, query) {
    if (/\.php$/.test(base)) return base + "?action=" + action + (query || "");
    if (route === "status") return base + "/status";
    return base + "/knobs?action=" + action + (query || "");
  }

  async function legacyCall(base, route, action, opts) {
    const { method = "GET", body = null, query = "" } = opts || {};
    const res = await fetch(
      legacyUrl(base, route, action, query),
      method === "GET"
        ? { cache: "no-store" }
        : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error((json && json.error) || ("HTTP " + res.status));
    return json;
  }

  function backends() {
    const out = [];
    if (supa()) out.push({ name: "supabase" });
    const cloud = window.JIGSAW_API_BASE || "";
    if (cloud) out.push({ name: "cloud", base: cloud.replace(/\/$/, "") });
    if (!isProduction() && window.JIGSAW_LOCAL_API) out.push({ name: "local", base: window.JIGSAW_LOCAL_API });
    return out;
  }

  async function call(route, action, opts) {
    let lastErr = new Error("No API configured.");
    const list = backends();
    for (let i = 0; i < list.length; i++) {
      try {
        const json = list[i].name === "supabase"
          ? await supabaseCall(action, opts)
          : list[i].name === "cloud"
            ? await legacyCall(list[i].base, route, action, opts)
            : await localCall(list[i].base, action, opts);
        call.usedBase = list[i].name;
        return json;
      } catch (e) {
        lastErr = e;
      }
    }
    call.usedBase = null;
    throw lastErr;
  }
  call.usedBase = null;

  return { call, isProduction };
})();

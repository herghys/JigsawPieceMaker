/* Shared API client: tries each backend in order, first success wins.
 *
 *   1. Cloud: window.JIGSAW_API_BASE (Vercel, set in assets/config.js
 *               after deploy; the REPLACE-WITH placeholder is skipped)
 *   2. Local: window.JIGSAW_LOCAL_API (relative PHP path, set per page
 *               because create/ and editor/ sit at different depths)
 *   3. Caller falls back to built-in defaults when all backends fail.
 *
 * Both backends speak the same contract ({ok, data, pending?}), so callers
 * don't care which one answered. window.JigsawAPI.usedBase reports
 * "cloud" | "local" | null after a call.
 */
window.JigsawAPI = (function () {
  function bases() {
    const out = [];
    const cloud = window.JIGSAW_API_BASE || "";
    if (cloud && cloud.indexOf("REPLACE-WITH") === -1) {
      out.push({ name: "cloud", base: cloud.replace(/\/$/, "") });
    }
    if (window.JIGSAW_LOCAL_API) {
      out.push({ name: "local", base: window.JIGSAW_LOCAL_API });
    }
    return out;
  }

  function urlFor(base, route, action, query) {
    if (/\.php$/.test(base)) return `${base}?action=${action}${query || ""}`;
    if (route === "status") return `${base}/status`;
    return `${base}/knobs?action=${action}${query || ""}`;
  }

  async function call(route, action, opts) {
    const { method = "GET", body = null, query = "" } = opts || {};
    let lastErr = new Error("No API configured.");
    const list = bases();
    for (let i = 0; i < list.length; i++) {
      const url = urlFor(list[i].base, route, action, query);
      try {
        const res = await fetch(
          url,
          method === "GET"
            ? { cache: "no-store" }
            : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error((json && json.error) || ("HTTP " + res.status));
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

  return { call };
})();

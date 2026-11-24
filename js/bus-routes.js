/**
 * 해시(#) 라우팅 — 뒤로가기·정류장 공유 링크
 * #/ 목록 · #/stop/{id}?n=이름
 */
(function (global) {
  function parseBusRoute() {
    const raw = (location.hash || "").replace(/^#/, "").trim();
    if (!raw || raw === "/") return { view: "list" };

    const qIdx = raw.indexOf("?");
    const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
    const queryPart = qIdx >= 0 ? raw.slice(qIdx + 1) : "";
    const parts = pathPart.split("/").filter(Boolean);

    if (!parts.length) return { view: "list" };

    const head = parts[0];
    if (head === "stop" && parts[1]) {
      return {
        view: "stop",
        id: decodeURIComponent(parts[1]),
        params: new URLSearchParams(queryPart),
      };
    }

    return { view: "list" };
  }

  function busRouteHash(route) {
    if (!route || route.view === "list") return "#/";
    if (route.view === "stop" && route.id) {
      const q =
        route.params instanceof URLSearchParams
          ? route.params
          : new URLSearchParams(route.params || {});
      const qs = q.toString();
      return qs
        ? `#/stop/${encodeURIComponent(route.id)}?${qs}`
        : `#/stop/${encodeURIComponent(route.id)}`;
    }
    return "#/";
  }

  function buildSharedStopUrl(stop, baseHref) {
    const u = new URL(baseHref || location.href);
    u.search = "";
    const q = new URLSearchParams();
    if (stop?.name) q.set("n", String(stop.name));
    const qs = q.toString();
    u.hash = qs
      ? `/stop/${encodeURIComponent(stop.id)}?${qs}`
      : `/stop/${encodeURIComponent(stop.id)}`;
    return u.href;
  }

  global.busRoutes = {
    parse: parseBusRoute,
    hash: busRouteHash,
    buildSharedStopUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
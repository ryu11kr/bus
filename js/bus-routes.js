/**
 * 해시(#) 라우팅 — 뒤로가기·정류장 공유 링크
 * #/ 목록 · #/stop/{id} 내 기기 · #/l/{token} 공개 링크
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
    if (head === "l" && parts[1]) {
      return { view: "link", token: decodeURIComponent(parts[1]) };
    }
    if (head === "stop" && parts[1]) {
      const params = new URLSearchParams(queryPart);
      const linkToken = params.get("l") || params.get("t") || "";
      return {
        view: "stop",
        id: decodeURIComponent(parts[1]),
        params,
        linkToken: linkToken.trim(),
      };
    }

    return { view: "list" };
  }

  function busRouteHash(route) {
    if (!route || route.view === "list") return "#/";
    if (route.view === "link" && route.token) {
      return `#/l/${encodeURIComponent(route.token)}`;
    }
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

  function buildLinkUrl(token, baseHref) {
    const u = new URL(baseHref || location.href);
    u.search = "";
    u.hash = `/l/${encodeURIComponent(token)}`;
    return u.href;
  }

  global.busRoutes = {
    parse: parseBusRoute,
    hash: busRouteHash,
    buildLinkUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
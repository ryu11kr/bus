/**
 * Path 라우팅 — PWA 뒤로가기·정류장 URL (핫플첩과 동일 방식)
 * / 목록 · /stop/{id} 내 정류장 · /l/{token} 공유 링크
 * 예전 #/… 해시 주소도 읽고 곧바로 path 로 맞춤
 */
(function (global) {
  function parseFromPathString(pathPart, queryPart) {
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

  function normalizePathname(pathname) {
    let p = pathname || "/";
    if (/\/index\.html$/i.test(p)) {
      p = p.replace(/\/index\.html$/i, "/") || "/";
    }
    if (p.length > 1 && p.endsWith("/")) {
      p = p.slice(0, -1);
    }
    return p || "/";
  }

  function parseBusRoute() {
    const hashRaw = (location.hash || "").replace(/^#/, "").trim();
    if (hashRaw && hashRaw !== "/") {
      const qIdx = hashRaw.indexOf("?");
      const pathPart = qIdx >= 0 ? hashRaw.slice(0, qIdx) : hashRaw;
      const queryPart = qIdx >= 0 ? hashRaw.slice(qIdx + 1) : "";
      return parseFromPathString(pathPart, queryPart);
    }

    const path = normalizePathname(location.pathname);
    if (path === "/") return { view: "list" };

    const parts = path.split("/").filter(Boolean);
    const queryPart = (location.search || "").replace(/^\?/, "");
    return parseFromPathString(parts.join("/"), queryPart);
  }

  function busRoutePath(route) {
    if (!route || route.view === "list") return "/";
    if (route.view === "link" && route.token) {
      return `/l/${encodeURIComponent(route.token)}`;
    }
    if (route.view === "stop" && route.id) {
      const q =
        route.params instanceof URLSearchParams
          ? route.params
          : new URLSearchParams(route.params || {});
      const qs = q.toString();
      const base = `/stop/${encodeURIComponent(route.id)}`;
      return qs ? `${base}?${qs}` : base;
    }
    return "/";
  }

  /** @deprecated 해시 문자열 — 내부·구버전 호환 */
  function busRouteHash(route) {
    const path = busRoutePath(route);
    if (path === "/") return "#/";
    return `#${path}`;
  }

  function locationRouteKey() {
    return busRoutePath(parseBusRoute());
  }

  function buildLinkUrl(token, baseHref) {
    const u = new URL(baseHref || location.href);
    u.search = "";
    u.hash = "";
    u.pathname = `/l/${encodeURIComponent(token)}`;
    return u.href;
  }

  function isSubView(route) {
    if (!route) return false;
    return route.view === "stop" || route.view === "link";
  }

  function usesLegacyHash() {
    const hashRaw = (location.hash || "").replace(/^#/, "").trim();
    return Boolean(hashRaw && hashRaw !== "/");
  }

  global.busRoutes = {
    parse: parseBusRoute,
    path: busRoutePath,
    hash: busRouteHash,
    locationRouteKey,
    buildLinkUrl,
    isSubView,
    usesLegacyHash,
  };
})(typeof window !== "undefined" ? window : globalThis);
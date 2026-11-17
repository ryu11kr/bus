/* 공통 PWA 서비스 워커 — 빌드 번호는 등록 URL 의 ?build= 값 */
importScripts("./sw.config.js");

const build = new URL(self.location.href).searchParams.get("build") || "1";
const CACHE_NAME = `${CACHE_PREFIX}-${build}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./css/styles.css",
  "./js/stop-photos.js",
  "./js/app.js",
  "./js/cloud-sync.js",
  "./js/cloud-sync-data.js",
  "./js/cloud-share.js",
  "./cloud-sync.config.json",
  "./version.json",
  "./manifest.webmanifest",
  "./pwa.config.json",
  "./sw.config.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  const path = url.pathname.replace(/\/$/, "");
  if (
    /\/(?:js\/[^/]+\.js|css\/styles\.css|version\.json|index\.html|cloud-sync\.runtime\.json|cloud-sync\.config\.json)$/.test(
      path
    )
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (data.type === "PURGE_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    );
    return;
  }

  if (data.type === "GET_VERSION") {
    event.source?.postMessage({ type: "VERSION", version: CACHE_NAME });
  }

  if (data.type === "LOCAL_NOTIFICATION_TEST") {
    const title = "기기 알림 테스트";
    const body = "이 문구가 보이면 폰·앱 알림은 정상입니다.";
    const iconUrl = new URL("./icons/icon-192.png", self.location.href).href;
    event.waitUntil(
      self.registration
        .showNotification(title, {
          body,
          icon: iconUrl,
          tag: `local-${Date.now()}`,
          renotify: true,
          vibrate: [200, 100, 200],
        })
        .catch(() =>
          self.registration.showNotification(title, {
            body,
            tag: `local-${Date.now()}`,
            renotify: true,
          })
        )
    );
  }
});

self.addEventListener("push", (event) => {
  /** @type {{ title?: string, body?: string, url?: string, requestId?: string }} */
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "내버스시간표";
  const body = data.body || "버스 정류장 정보를 공유했습니다.";
  const url = data.url || "./?share=pending";
  const tag = data.requestId ? `bus-share-${data.requestId}` : "bus-share";
  const iconUrl = new URL("./icons/icon-192.png", self.location.href).href;

  event.waitUntil(
    (async () => {
      const opts = {
        body,
        tag,
        data: { url },
        renotify: true,
        vibrate: [180, 80, 180],
        icon: iconUrl,
        badge: iconUrl,
      };
      try {
        await self.registration.showNotification(title, opts);
      } catch {
        await self.registration.showNotification(title, {
          body,
          tag,
          data: { url },
          renotify: true,
          vibrate: [180, 80, 180],
        });
      }
      const requestId = typeof data.requestId === "string" ? data.requestId : "";
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const win of windowClients) {
        if (!win.url.startsWith(self.location.origin)) continue;
        win.postMessage({ type: "BUS_SHARE_INCOMING", requestId });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "./?share=pending";
  const absolute = new URL(target, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          await client.focus();
          client.navigate?.(absolute);
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(absolute);
      }
    })()
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match("./offline.html");
    if (offline) return offline;
    return new Response("오프라인 상태이고, 저장된 페이지가 없습니다.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || network;
}
// 앱 화면 파일은 저장해 두고(인터넷이 끊겨도 열림), 분석 자료는 항상 새로 받되 실패하면 마지막 자료를 보여 줍니다.
const CACHE = "ss-app-v2.13.0";
const SHELL = ["./", "index.html", "app.css?v=2.13.0", "app.js?v=2.13.0", "manifest.json", "icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE && k !== "ss-data").map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "raw.githubusercontent.com") {
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open("ss-data").then((c) => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req)));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: false }).then((r) => r || caches.match("index.html"))));
});

// 🔔 휴대폰 알림 (내 종목 급등락·오늘 정리)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "스톡시그널", {
    body: d.body || "", tag: d.tag || "ss", icon: "icon-192.png", badge: "icon-192.png", data: { url: d.url || "./#/my" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || "./#/my", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

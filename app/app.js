/* 스톡시그널 앱 v2.0.0
   - 매일 오후 5시에 계산해 둔 파일(AI 확률·차트·뉴스·테마)과 장중 20분마다 모은 현재가를 읽어서 바로 보여 줌.
   - 서버 계산이 없어서 빠르고, 한 번 본 자료는 인터넷이 끊겨도 다시 볼 수 있음. */
"use strict";
const VERSION = "2.0.0";
const QS = new URLSearchParams(location.search);
const DATA = QS.get("data") || "https://raw.githubusercontent.com/7415794-alt/stock-ai/data/app/";
const LIVE = QS.get("live") || "https://raw.githubusercontent.com/7415794-alt/stock-ai/live/live.json";
const HS = [1, 5, 20];
const ALERT = ["", "투자주의", "투자경고", "투자위험"];
const ROLE = { L: ["👑", "시총 대장주"], M: ["🚀", "상승 대장주"], F: ["💰", "수급 대장주"] };

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 안 돼도 앱은 동작 */ } },
};

// ───────── 설정 (기간·화면 색) ─────────
let H = [1, 5, 20].includes(store.get("ss-h", 5)) ? store.get("ss-h", 5) : 5;
function setH(h) { H = h; store.set("ss-h", h); render(); }
function applyTheme() {
  const t = store.get("ss-theme", "auto");
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
applyTheme();

// ───────── 자료 받기 ─────────
const memo = new Map();
function getJSON(url, ttl = 600000) {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  });
  memo.set(url, { t: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
let INDEX = null, BYCODE = new Map(), META = null, LIVEJ = null;
async function loadIndex() {
  if (INDEX) return INDEX;
  const [ix, meta] = await Promise.all([getJSON(DATA + "index.json"), getJSON(DATA + "meta.json").catch(() => null)]);
  META = meta;
  const c = ix.cols;
  INDEX = ix.rows.map((r) => Object.fromEntries(c.map((k, i) => [k, r[i]])));
  INDEX.forEach((s) => { s.key = (s.name + s.code).toLowerCase().replace(/\s/g, ""); BYCODE.set(s.code, s); });
  return INDEX;
}
async function loadLive(force) {
  try {
    if (force) memo.delete(LIVE);
    LIVEJ = await getJSON(LIVE, 240000);
  } catch { /* 장중 가격이 없어도 오후 5시 자료로 보여 줌 */ }
  return LIVEJ;
}
const live = (code) => LIVEJ && LIVEJ.s && LIVEJ.s[code];
function liveLabel() {
  if (!LIVEJ) return "";
  const [d, t] = LIVEJ.t.split(" ");
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  return d === today ? `${t} 기준` : `${+d.slice(5, 7)}/${+d.slice(8, 10)} ${t} 기준`;
}

// ───────── 글자 모양 ─────────
const won = (v) => (v == null ? "-" : Number(v).toLocaleString("ko-KR"));
const pctTxt = (v, d = 2) => (v == null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
function pill(p) {
  if (p == null) return `<span class="pill">-</span>`;
  const c = p >= 0.6 ? "u2" : p >= 0.5 ? "u1" : p > 0.4 ? "d1" : "d2";
  return `<span class="pill ${c}">${Math.round(p * 100)}%</span>`;
}
function word(p) {
  if (p >= 0.65) return "오를 가능성이 높아요";
  if (p >= 0.55) return "오를 가능성이 조금 더 높아요";
  if (p > 0.45) return "오를지 내릴지 비슷해요";
  if (p > 0.35) return "내릴 가능성이 조금 더 높아요";
  return "내릴 가능성이 높아요";
}
function priceOf(s) {
  const l = live(s.code);
  if (l && l[0] != null) return { now: l[0], chg: l[1], halted: l[3], live: true };
  return { now: s.close, chg: s.chg == null ? null : s.chg * 100, halted: !!s.halted, live: false };
}
const ymd = (n) => { const s = String(n).padStart(6, "0"); return `${s.slice(0, 2)}.${s.slice(2, 4)}.${s.slice(4)}`; };
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}
const segH = () => `<div class="seg" data-seg="h">${HS.map((h) => `<button data-h="${h}" class="${h === H ? "on" : ""}">${h}일 뒤</button>`).join("")}</div>`;

// ───────── 내 종목·최근 본 종목 (예전 앱 관심 종목도 가져옴) ─────────
function codesFrom(raw) {
  if (!raw) return [];
  return String(raw).split(",").map((x) => (x.match(/\d{6}/) || [])[0]).filter(Boolean);
}
(function importOld() {
  if (localStorage.getItem("ss-fav") != null) return;
  let old = [];
  try { old = codesFrom(localStorage.getItem("stock-ai-fav")); } catch { /* 없음 */ }
  store.set("ss-fav", [...new Set(old)]);
})();
const favs = () => store.get("ss-fav", []);
const isFav = (c) => favs().includes(c);
function toggleFav(c) {
  const f = favs();
  const i = f.indexOf(c);
  if (i >= 0) f.splice(i, 1); else f.unshift(c);
  store.set("ss-fav", f);
  toast(i >= 0 ? "내 종목에서 뺐어요" : "⭐ 내 종목에 담았어요");
  return i < 0;
}
function addRecent(c) {
  const r = store.get("ss-recent", []).filter((x) => x !== c);
  r.unshift(c);
  store.set("ss-recent", r.slice(0, 10));
}

// ───────── 종목 한 줄 ─────────
function stockRow(s, opt = {}) {
  const pr = priceOf(s);
  const p = s["p" + H];
  const hr = s["hr" + H];
  const flags = (s.managed ? `<span class="badge">관리</span>` : "") + (s.alert ? `<span class="badge">${ALERT[s.alert]}</span>` : "")
    + (pr.halted ? `<span class="badge">거래정지</span>` : "");
  const sub = opt.sub ?? `${s.market === "KOSPI" ? "코스피" : "코스닥"} · ${won(pr.now)}원 <span class="${cls(pr.chg)}">${pctTxt(pr.chg)}</span>`;
  return `<a class="row" href="#/s/${s.code}">
    ${opt.rank ? `<span class="muted small" style="width:22px">${opt.rank}</span>` : ""}
    <div class="nm"><b>${esc(s.name)}${flags}</b><small>${sub}</small></div>
    <div class="rt">${pill(p)}${hr != null && opt.hr !== false ? `<br><small class="muted">적중 ${Math.round(hr * 100)}%</small>` : ""}</div></a>`;
}

// ───────── 검색 ─────────
const q = $("#q"), sug = $("#sug");
function searchList(text, n = 8) {
  const k = text.toLowerCase().replace(/\s/g, "");
  if (!k || !INDEX) return [];
  const out = [];
  for (const s of INDEX) {
    const i = s.key.indexOf(k);
    if (i < 0) continue;
    const score = (s.name.toLowerCase().replace(/\s/g, "") === k || s.code === k ? 0 : i === 0 ? 1 : 2) + (s.p5 == null ? 0.5 : 0);
    out.push([score, s.name.length, s]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.slice(0, n).map((x) => x[2]);
}
q.addEventListener("input", async () => {
  await loadIndex().catch(() => null);
  const list = searchList(q.value);
  if (!q.value.trim()) { sug.hidden = true; return; }
  sug.innerHTML = list.length
    ? list.map((s) => `<a href="#/s/${s.code}"><span>${esc(s.name)} <small>${s.code}</small></span>${pill(s["p" + H])}</a>`).join("")
    : `<div class="empty" style="padding:14px">'${esc(q.value)}' 종목을 못 찾았어요</div>`;
  sug.hidden = false;
});
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const s = searchList(q.value, 1)[0];
    if (s) { location.hash = `#/s/${s.code}`; q.value = ""; sug.hidden = true; q.blur(); }
  }
});
sug.addEventListener("click", () => { sug.hidden = true; q.value = ""; q.blur(); });
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) sug.hidden = true; });

// ───────── 화면 바꾸기 ─────────
const routes = [];
const route = (re, fn, tab) => routes.push({ re, fn, tab });
let renderId = 0;
async function render() {
  const h = location.hash.replace(/^#/, "") || "/";
  const r = routes.find((x) => x.re.test(h)) || routes[0];
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === r.tab));
  const id = ++renderId;
  try {
    const html = await r.fn(...(h.match(r.re) || []).slice(1));
    if (id !== renderId) return;
    if (typeof html === "string") view.innerHTML = html;
    afterRender();
  } catch (e) {
    if (id !== renderId) return;
    view.innerHTML = `<div class="empty">자료를 불러오지 못했어요 😥<br><small>인터넷 연결을 확인하고 다시 열어 주세요. (${esc(e.message)})</small><br><br>
      <button class="more" onclick="location.reload()">다시 시도</button></div>`;
  }
}
let lastHash = "";
window.addEventListener("hashchange", () => {
  const base = (x) => x.split("?")[0];
  if (base(location.hash) !== base(lastHash)) window.scrollTo(0, 0);
  lastHash = location.hash;
  render();
});
view.addEventListener("click", (e) => {
  const b = e.target.closest("[data-h]");
  if (b && b.closest('[data-seg="h"]')) { setH(+b.dataset.h); return; }
});
let afterHooks = [];
function after(fn) { afterHooks.push(fn); }
function afterRender() { const hs = afterHooks; afterHooks = []; hs.forEach((f) => f()); }
const foot = () => `<p class="foot">AI 확률은 과거 자료로 계산한 참고 정보이며 투자 권유가 아니에요. 투자 판단과 책임은 본인에게 있어요.<br>
  <a href="/disclaimer.html">면책 고지</a> · <a href="/privacy.html">개인정보처리방침</a> · v${VERSION}</p>`;

// ───────── 🏠 홈 ─────────
route(/^\/$/, async () => {
  await Promise.all([loadIndex(), loadLive()]);
  const idx = (LIVEJ && LIVEJ.idx) || {};
  const mk = ["KOSPI", "KOSDAQ"].map((k) => {
    const v = idx[k];
    return `<div class="stat"><small>${k === "KOSPI" ? "코스피" : "코스닥"}</small>
      <b>${v ? v[0].toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "-"}</b>
      <div class="${cls(v && v[1])}">${v ? pctTxt(v[1]) : ""}</div></div>`;
  }).join("");
  const ok = INDEX.filter((s) => s["p" + H] != null && !s.managed && !s.alert && !s.halted);
  const top = [...ok].sort((a, b) => b["p" + H] - a["p" + H]).slice(0, 10);
  const fav = favs().map((c) => BYCODE.get(c)).filter(Boolean);
  const rec = store.get("ss-recent", []).map((c) => BYCODE.get(c)).filter(Boolean).slice(0, 5);
  return `
  <div class="card"><h2>📊 오늘 시장 <small>${esc(liveLabel())}</small></h2><div class="mkt">${mk}</div></div>
  <div class="toolbar">${segH()}<span class="muted small">AI 기준일 ${esc(META?.date || "-")}</span></div>
  <div class="card"><h2>⭐ 내 종목 <a class="small muted" href="#/my">전체 ›</a></h2>
    ${fav.length ? fav.slice(0, 5).map((s) => stockRow(s)).join("") : `<div class="muted small">종목 화면에서 ☆를 누르면 여기에 모여요.</div>`}</div>
  <div class="card"><h2>🔥 ${H}일 뒤 상승 확률 TOP 10 <a class="small muted" href="#/rank">더 보기 ›</a></h2>
    ${top.map((s, i) => stockRow(s, { rank: i + 1 })).join("")}
    <p class="muted small">관리종목·투자주의 종목·거래정지 종목은 뺐어요. 적중 = 최근 60번 예측 중 맞힌 비율.</p></div>
  ${rec.length ? `<div class="card"><h2>🕘 최근 본 종목</h2>${rec.map((s) => stockRow(s)).join("")}</div>` : ""}
  <div class="card"><h2>❓ 처음이신가요?</h2>
    <p class="small" style="margin:0">위 검색창에 종목 이름을 넣으면 AI가 1·5·20거래일 뒤 오를 확률을 보여 줘요.
    매일 오후 5시에 전 종목을 다시 계산하고, 장중 가격은 20분마다 새로 고쳐요.
    <a href="/guide.html" style="text-decoration:underline">사용 설명서</a></p></div>
  ${foot()}`;
}, "home");

// ───────── 📈 종목 분석 ─────────
route(/^\/s\/(\d{6})/, async (code) => {
  view.innerHTML = `<div class="loading">AI 분석 불러오는 중…</div>`;
  await loadIndex().catch(() => null);
  loadLive();
  let d;
  try { d = await getJSON(`${DATA}s/${code}.json`); } catch {
    const s = BYCODE.get(code);
    return `<div class="card"><h2>${esc(s ? s.name : code)}</h2>
      <p>${s && s.halted ? "거래정지 종목이라 오늘은 AI 분석이 없어요." : "이 종목은 오늘 AI 분석 자료가 없어요. (새로 상장했거나 자료가 부족해요)"}</p></div>${foot()}`;
  }
  await loadLive();
  addRecent(code);
  const s = BYCODE.get(code) || { code, close: d.close, chg: d.chg };
  const pr = priceOf(s);
  const P = d.prob[H] || d.prob[String(H)];
  const ST = d.stat[H] || d.stat[String(H)] || {};
  const flags = (d.managed ? `<span class="badge">관리종목</span>` : "") + (d.alert ? `<span class="badge">${ALERT[d.alert]}</span>` : "")
    + (pr.halted ? `<span class="badge">거래정지</span>` : "");
  const fav = isFav(code);

  // 확률
  let probHtml = `<div class="empty">이 기간은 분석이 없어요</div>`;
  if (P) {
    const parts = [`AI ${(P.ai * 100).toFixed(1)}%`];
    if (P.news) parts.push(`뉴스 ${P.news > 0 ? "+" : ""}${(P.news * 100).toFixed(1)}%p`);
    if (P.theme) parts.push(`테마 ${P.theme > 0 ? "+" : ""}${(P.theme * 100).toFixed(1)}%p`);
    probHtml = `<div class="hero"><div class="lbl">${H}거래일 뒤 오를 확률</div>
      <div class="big ${P.p >= 0.5 ? "up" : "down"}">${Math.round(P.p * 100)}%</div>
      <div><b>${word(P.p)}</b></div>
      <div class="meter"><i style="left:${(P.p * 100).toFixed(1)}%"></i></div>
      <div class="muted small" style="display:flex;justify-content:space-between"><span>내릴 쪽</span><span>50%</span><span>오를 쪽</span></div>
      <div class="muted small" style="margin-top:6px">${parts.join(" · ")}</div></div>`;
  }

  // AI 성적
  const hr = ST.n ? ST.hits / ST.n : null;
  const weak = (hr != null && hr < 0.5) || (ST.auc != null && ST.auc < 0.52);
  const tr = (d.track[H] || d.track[String(H)] || []).slice(-30);
  const trackHtml = tr.length ? `<div class="track">${tr.map(([dt, p, r]) => {
    if (r == null) return `<span class="w" title="${ymd(dt)} 결과 기다리는 중">…</span>`;
    const hit = (p >= 0.5) === (r > 0);
    return `<span class="${hit ? "o" : "x"}" title="${ymd(dt)} 확률 ${Math.round(p * 100)}% → ${(r * 100).toFixed(1)}%">${hit ? "○" : "×"}</span>`;
  }).join("")}</div><p class="muted small">최근 ${tr.length}번 예측 (왼쪽이 오래된 것). ○ 맞힘 · × 틀림 · … 아직 결과 전. 칸을 길게 누르면 날짜가 보여요.</p>` : "";
  const statHtml = `<div class="split">
    <div class="stat"><small>최근 예측 적중</small><b>${ST.n ? `${ST.hits}/${ST.n}` : "-"}</b> <span class="muted small">${hr != null ? Math.round(hr * 100) + "%" : ""}</span></div>
    <div class="stat"><small>시험 정확도 (그냥 찍기)</small><b>${ST.acc != null ? (ST.acc * 100).toFixed(1) + "%" : "-"}</b> <span class="muted small">(${ST.base != null ? (ST.base * 100).toFixed(1) + "%" : "-"})</span></div></div>
    ${weak ? `<div class="warnbox">⚠️ 이 종목은 최근 AI 성적이 좋지 않아요. 확률은 참고만 하세요.</div>` : ""}
    <p class="muted small">그냥 찍기 = 이 기간 동안 더 자주 나온 쪽(오름 또는 내림)으로만 답했을 때의 정확도. AI가 이것보다 높아야 의미가 있어요.</p>`;

  // 수급
  const ind = d.ind || {};
  const fl = [["외국인", ind.fl_frg5], ["기관", ind.fl_org5], ["개인", ind.fl_ind5]];
  const flHtml = fl.some((x) => x[1] != null) ? `<div class="card"><h2>🤝 수급 <small>최근 5일, 전날까지</small></h2><div class="bars">
    ${fl.map(([n, v]) => {
      if (v == null) return `<div class="b"><span>${n}</span><div class="track2"></div><span>-</span></div>`;
      const w = Math.min(Math.abs(v) / 0.2, 1) * 50;
      return `<div class="b"><span>${n}</span><div class="track2"><i style="${v >= 0 ? `left:50%;width:${w}%;background:var(--up)` : `right:50%;width:${w}%;background:var(--down)`}"></i></div>
        <span class="${cls(v)}">${flPct(v)}</span></div>`;
    }).join("")}</div>
    <p class="muted small">하루 평균 순매수량 ÷ 평소 하루 거래량. +면 사는 쪽, −면 파는 쪽이 많았어요. AI도 이 값을 함께 봐요.</p></div>` : "";

  // 테마
  const thHtml = d.themes && d.themes.length ? `<div class="card"><h2>🧩 속한 테마</h2><div class="chips">${d.themes.map(([no, name, roles]) =>
    `<a class="chip" href="#/t/${no}">${[...(roles || "")].map((r) => ROLE[r][0]).join("")}${esc(name)}</a>`).join("")}</div>
    ${d.themes.some((t) => t[2]) ? `<p class="muted small">👑 시총 대장주 · 🚀 상승 대장주 · 💰 수급 대장주</p>` : ""}</div>` : "";

  // 뉴스
  const newsHtml = `<div class="card news"><h2>📰 최근 뉴스</h2>${d.news && d.news.length ? d.news.map((n) =>
    `<a href="${esc(n.u)}" target="_blank" rel="noopener"><span class="tag ${n.s > 0 ? "p" : n.s < 0 ? "n" : "z"}">${n.s > 0 ? "호재" : n.s < 0 ? "악재" : "중립"}</span>${esc(n.t)}
      <br><small>${esc(n.src)} · ${esc(n.w.slice(5))}</small></a>`).join("") : `<div class="muted small">최근 뉴스가 없어요.</div>`}
    <p class="muted small">호재·악재는 기사 제목의 단어로 AI가 판단했어요.</p></div>`;

  // 기업 정보
  const f = d.fin || {};
  const n = (k) => (f[k] == null ? null : parseFloat(String(f[k]).replace(/,/g, "")));
  const finItems = [["PER", n("per"), (v) => v.toFixed(1) + "배"], ["PBR", n("pbr"), (v) => v.toFixed(2) + "배"], ["ROE", n("roe"), (v) => v.toFixed(1) + "%"],
    ["배당수익률", n("dividendRate"), (v) => v.toFixed(2) + "%"], ["매출 성장률", n("salesIncreasingRate"), (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "%"],
    ["영업이익 성장률", n("operatingProfitIncreasingRate"), (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "%"]];
  const prop = n("propertyTotal"), debt = n("debtTotal");
  if (prop && debt != null && prop - debt > 0) finItems.push(["부채비율", debt / (prop - debt) * 100, (v) => v.toFixed(0) + "%"]);
  if (n("sales")) finItems.push(["매출액", n("sales"), (v) => (v >= 10000 ? (v / 10000).toFixed(1) + "조" : v.toLocaleString("ko-KR") + "억")]);
  const finHtml = finItems.some((x) => x[1] != null && !isNaN(x[1])) ? `<div class="card"><h2>🏢 기업 정보</h2><div class="fin">${finItems.filter((x) => x[1] != null && !isNaN(x[1]))
    .map(([k, v, fm]) => `<div class="stat"><small>${k}</small><b style="font-size:15px">${fm(v)}</b></div>`).join("")}</div>
    <p class="muted small">네이버 증권 최근 결산 기준. AI 확률 계산에는 쓰지 않는 참고 정보예요.</p></div>` : "";

  after(() => {
    drawChart($("#chart"), d.chart, store.get("ss-range", 120));
    $("#fav").onclick = () => { const on = toggleFav(code); $("#fav").textContent = on ? "★" : "☆"; };
    $("#share").onclick = () => share(d.name, code, P);
    document.querySelectorAll("[data-range]").forEach((b) => b.onclick = () => {
      store.set("ss-range", +b.dataset.range);
      document.querySelectorAll("[data-range]").forEach((x) => x.classList.toggle("on", x === b));
      drawChart($("#chart"), d.chart, +b.dataset.range);
    });
    $("#indbox").addEventListener("toggle", (e) => { if (e.target.open) indTable(d); }, { once: true });
  });
  const rg = store.get("ss-range", 120);
  return `
  <div class="card">
    <div class="head"><div><h1>${esc(d.name)}${flags}</h1><div class="muted small">${code} · ${d.market === "KOSPI" ? "코스피" : "코스닥"}</div></div>
      <div style="display:flex;gap:6px"><button class="icon-btn" id="share" aria-label="공유">공유</button>
      <button class="icon-btn" id="fav" aria-label="내 종목" style="font-size:18px;padding:3px 10px">${fav ? "★" : "☆"}</button></div></div>
    <div class="price" style="margin-top:8px"><b>${won(pr.now)}원</b><span class="${cls(pr.chg)}">${pctTxt(pr.chg)}</span>
      <small class="muted">${pr.live ? esc(liveLabel()) : `${esc(d.date)} 종가`}</small></div>
  </div>
  <div class="card"><div style="text-align:center;margin-bottom:6px">${segH()}</div>${probHtml}
    <p class="muted small" style="text-align:center">AI 기준일 ${esc(d.date)} 종가 · 매일 오후 5시 새로 계산</p></div>
  <div class="card"><h2>📈 주가 <span class="seg">${[[60, "3개월"], [120, "6개월"], [260, "1년"]].map(([k, l]) => `<button data-range="${k}" class="${k === rg ? "on" : ""}">${l}</button>`).join("")}</span></h2>
    <canvas id="chart" height="230"></canvas><p class="muted small" id="chartinfo">선 = 종가 · <span style="color:#f59e0b">주황</span> 20일 평균 · <span style="color:#8b5cf6">보라</span> 60일 평균 · 아래 막대 = 거래량</p></div>
  <div class="card"><h2>🎯 이 종목 AI 성적 <small>${H}일 뒤</small></h2>${statHtml}${trackHtml}</div>
  ${flHtml}${thHtml}${newsHtml}${finHtml}
  <div class="card"><details id="indbox"><summary>🧮 AI가 본 지표 50가지</summary><div id="indt" class="loading">불러오는 중…</div></details></div>
  ${foot()}`;
}, "home");

async function share(name, code, P) {
  const url = `${location.origin}${location.pathname}#/s/${code}`;
  const text = P ? `${name} ${H}일 뒤 AI 상승 확률 ${Math.round(P.p * 100)}% - 스톡시그널` : `${name} - 스톡시그널`;
  try {
    if (navigator.share) { await navigator.share({ title: "스톡시그널", text, url }); return; }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("링크를 복사했어요");
  } catch { /* 취소 */ }
}

// 차트 (종가 선 + 20·60일 평균 + 거래량)
function drawChart(cv, ch, n) {
  if (!cv || !ch || !ch.c.length) return;
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  const ma = (k) => ch.c.map((_, i) => (i + 1 < k ? null : ch.c.slice(i + 1 - k, i + 1).reduce((a, b) => a + b, 0) / k));
  const m20 = ma(20), m60 = ma(60);
  const st = Math.max(0, ch.c.length - n);
  const C = ch.c.slice(st), V = ch.v.slice(st), D = ch.d.slice(st), A = m20.slice(st), B = m60.slice(st);
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, Hh = 230;
  cv.width = W * dpr; cv.height = Hh * dpr; cv.style.height = Hh + "px";
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const pad = { l: 4, r: 56, t: 8, b: 18 }, vh = 40;
  const ph = Hh - pad.t - pad.b - vh - 6;
  const all = C.concat(A.filter((x) => x != null), B.filter((x) => x != null));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; }
  const x = (i) => pad.l + (W - pad.l - pad.r) * (C.length === 1 ? 0.5 : i / (C.length - 1));
  const y = (v) => pad.t + ph * (1 - (v - lo) / (hi - lo));
  function frame(hover) {
    g.clearRect(0, 0, W, Hh);
    g.font = "11px sans-serif";
    g.fillStyle = col("--muted");
    g.strokeStyle = col("--line");
    g.lineWidth = 1;
    for (let k = 0; k <= 3; k++) {
      const v = lo + (hi - lo) * k / 3, yy = y(v);
      g.beginPath(); g.moveTo(pad.l, yy); g.lineTo(W - pad.r, yy); g.stroke();
      g.fillText(Math.round(v).toLocaleString("ko-KR"), W - pad.r + 4, yy + 4);
    }
    const vmax = Math.max(...V) || 1, vb = Hh - pad.b;
    const bw = Math.max(1, (W - pad.l - pad.r) / C.length - 1);
    V.forEach((v, i) => {
      g.fillStyle = i && C[i] < C[i - 1] ? col("--down") : col("--up");
      g.globalAlpha = 0.45;
      const hgt = vh * v / vmax;
      g.fillRect(x(i) - bw / 2, vb - hgt, bw, hgt);
    });
    g.globalAlpha = 1;
    const line = (arr, color, w) => {
      g.strokeStyle = color; g.lineWidth = w; g.beginPath();
      let on = false;
      arr.forEach((v, i) => { if (v == null) return; on ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)); on = true; });
      g.stroke();
    };
    line(B, "#8b5cf6", 1.2);
    line(A, "#f59e0b", 1.2);
    line(C, C[C.length - 1] >= C[0] ? col("--up") : col("--down"), 2);
    g.fillStyle = col("--muted");
    g.fillText(ymd(D[0]), pad.l, Hh - 4);
    const last = ymd(D[D.length - 1]);
    g.fillText(last, W - pad.r - g.measureText(last).width, Hh - 4);
    if (hover != null) {
      g.strokeStyle = col("--fg"); g.lineWidth = 0.7; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x(hover), pad.t); g.lineTo(x(hover), Hh - pad.b); g.stroke(); g.setLineDash([]);
      g.fillStyle = col("--fg"); g.beginPath(); g.arc(x(hover), y(C[hover]), 3.5, 0, 7); g.fill();
    }
  }
  frame(null);
  const info = $("#chartinfo"), base = info.innerHTML;
  const at = (e) => {
    const r = cv.getBoundingClientRect();
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const i = Math.round((px - pad.l) / (W - pad.l - pad.r) * (C.length - 1));
    return Math.max(0, Math.min(C.length - 1, i));
  };
  const show = (e) => {
    const i = at(e);
    frame(i);
    const ch1 = i ? (C[i] / C[i - 1] - 1) * 100 : null;
    info.innerHTML = `<b>${ymd(D[i])}</b> 종가 ${won(C[i])}원 <span class="${cls(ch1)}">${pctTxt(ch1)}</span> · 거래량 ${won(V[i])}`;
  };
  const hide = () => { frame(null); info.innerHTML = base; };
  cv.onmousemove = show; cv.onmouseleave = hide;
  cv.ontouchstart = show; cv.ontouchmove = (e) => { show(e); }; cv.ontouchend = hide;
}

// 지표 50가지 표
const PCT = ["mom_", "rs_", "_gap", "_slope", "roc_", "atr_pct", "rvol_", "bb_width", "macd_h", "ichi_"];
const flPct = (v) => { const r = Math.round(v * 100); return `${r > 0 ? "+" : ""}${r}%`; };
function fmtInd(c, v) {
  if (v == null) return "-";
  if (c.startsWith("fl_")) return flPct(v);
  if (PCT.some((h) => c.startsWith(h) || c.includes(h))) return `${v > 0 ? "+" : ""}${(v * 100).toFixed(c === "macd_h" ? 2 : 1)}%`;
  if (["hhll", "double_pat", "hs_pat", "cross_5_20", "cross_20_60"].includes(c)) return `${v > 0 ? "+" : ""}${v.toFixed(0)}`;
  return v.toFixed(2);
}
async function indTable(d) {
  const box = $("#indt");
  try {
    const I = await getJSON(DATA + "ind.json", 3600000);
    const imp = I.imp[String(H)] || {};
    const has = (cols) => cols.length && cols.every((c) => c in imp);
    const fl = Object.keys(imp).filter((c) => c.startsWith("fl_"));
    const rows = (I.table[String(H)] || []).map(([rank, name, typ, desc, cols]) => {
      const val = cols.length ? cols.map((c) => fmtInd(c, d.ind[c])).join(" · ") : "값은 위 기업 정보 참고";
      const used = has(cols) ? `✅ ${(cols.reduce((a, c) => a + (imp[c] || 0), 0) * 100).toFixed(1)}%` : cols.length ? "➖" : "✖";
      return `<tr><td>${rank}</td><td><b>${esc(name)}</b> <small class="muted">${esc(typ)}</small><br><small class="muted">${esc(desc)}</small><br><small>현재 ${val}</small></td><td class="r">${used}</td></tr>`;
    });
    if (fl.length) {
      rows.unshift(`<tr><td>+</td><td><b>수급 (외국인·기관·개인)</b> <small class="muted">수급</small><br><small class="muted">최근 5일 순매수 ÷ 평소 거래량</small>
        <br><small>현재 ${["fl_frg5", "fl_org5", "fl_ind5"].map((c) => fmtInd(c, d.ind[c])).join(" · ")}</small></td>
        <td class="r">✅ ${(fl.reduce((a, c) => a + imp[c], 0) * 100).toFixed(1)}%</td></tr>`);
    }
    const o = I.oos[String(H)] || {};
    box.className = "";
    box.innerHTML = `<div><table><tr><th>#</th><th>지표 · 현재 값</th><th class="r">AI 중요도</th></tr>${rows.join("")}</table></div>
      <p class="muted small">✅ AI가 학습한 지표(전 종목에서 중요하게 본 정도) · ➖ 이 기간엔 안 씀 · ✖ 자료 없음(실적 지표는 기업 정보 참고).
      ${o.oos_acc ? `전 종목 시험 정확도 ${(o.oos_acc * 100).toFixed(1)}% (AUC ${o.oos_auc.toFixed(3)}, 시험 ${Number(o.rows).toLocaleString("ko-KR")}건).` : ""}</p>`;
  } catch { box.textContent = "지표 자료를 불러오지 못했어요."; }
}

// ───────── 🏆 순위 ─────────
let rankState = store.get("ss-rank", { by: "up", mkt: "ALL", safe: true });
let rankShow = 50;
route(/^\/rank/, async () => {
  await Promise.all([loadIndex(), loadLive()]);
  const k = "p" + H, hk = "hr" + H;
  let list = INDEX.filter((s) => s[k] != null && !s.halted);
  if (rankState.mkt !== "ALL") list = list.filter((s) => s.market === rankState.mkt);
  if (rankState.safe) list = list.filter((s) => !s.managed && !s.alert);
  if (rankState.by === "up") list.sort((a, b) => b[k] - a[k]);
  else if (rankState.by === "down") list.sort((a, b) => a[k] - b[k]);
  else list = list.filter((s) => s[hk] != null).sort((a, b) => b[hk] - a[hk] || Math.abs(b[k] - 0.5) - Math.abs(a[k] - 0.5));
  const seg = (name, opts, cur) => `<div class="seg" data-rk="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${l}</button>`).join("")}</div>`;
  after(() => {
    document.querySelectorAll("[data-rk] button").forEach((b) => b.onclick = () => {
      rankState[b.parentElement.dataset.rk] = b.dataset.v; store.set("ss-rank", rankState); rankShow = 50; render();
    });
    $("#safe").onchange = (e) => { rankState.safe = e.target.checked; store.set("ss-rank", rankState); render(); };
    const m = $("#rkmore"); if (m) m.onclick = () => { rankShow += 50; render(); };
  });
  const title = { up: "오를 확률 높은 순", down: "내릴 확률 높은 순", hit: "AI 적중률 높은 순" }[rankState.by];
  return `<div class="toolbar">${seg("by", [["up", "상승"], ["down", "하락"], ["hit", "적중률"]], rankState.by)}${segH()}</div>
  <div class="toolbar">${seg("mkt", [["ALL", "전체"], ["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]], rankState.mkt)}
    <label class="ck"><input type="checkbox" id="safe" ${rankState.safe ? "checked" : ""}> 관리·주의 종목 빼기</label></div>
  <div class="card"><h2>${H}일 뒤 ${title} <small>${list.length.toLocaleString("ko-KR")}종목</small></h2>
    ${list.slice(0, rankShow).map((s, i) => stockRow(s, { rank: i + 1 })).join("")}
    ${list.length > rankShow ? `<button class="more" id="rkmore">50개 더 보기</button>` : ""}
    <p class="muted small">확률 = AI + 뉴스 + 테마 소식 반영 · 적중 = 최근 60번 예측 중 맞힌 비율 · AI 기준일 ${esc(META?.date || "-")}</p></div>${foot()}`;
}, "rank");

// ───────── 🧩 테마 ─────────
let themeQ = "";
route(/^\/themes/, async () => {
  view.innerHTML = `<div class="loading">테마 불러오는 중…</div>`;
  const T = await getJSON(DATA + "themes.json", 3600000);
  const k = themeQ.toLowerCase().replace(/\s/g, "");
  const list = k ? T.filter((t) => t.name.toLowerCase().replace(/\s/g, "").includes(k) || t.stocks.some((s) => s[1].toLowerCase().replace(/\s/g, "").includes(k))) : T;
  after(() => {
    const inp = $("#tq");
    inp.oninput = () => { themeQ = inp.value; clearTimeout(inp._t); inp._t = setTimeout(() => { render().then(() => { const i = $("#tq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250); };
  });
  return `<div class="card"><input id="tq" class="num" type="search" placeholder="테마 또는 종목 이름 (예: 반도체, 2차전지)" value="${esc(themeQ)}"></div>
  <div class="card"><h2>오늘 테마 등락 <small>${list.length}개</small></h2>
  ${list.slice(0, 120).map((t) => {
    const lead = t.stocks.find((s) => s[4].includes("L"));
    return `<a class="row" href="#/t/${t.no}"><div class="nm"><b>${esc(t.name)}</b><small>${t.stocks.length}종목${lead ? ` · 👑 ${esc(lead[1])}` : ""}</small></div>
      <div class="rt"><b class="${cls(t.chg)}">${pctTxt(t.chg)}</b></div></a>`;
  }).join("") || `<div class="muted small">찾는 테마가 없어요.</div>`}
  <p class="muted small">테마 등락 = 테마 종목들의 오늘 평균 등락률 (오후 5시 기준).</p></div>${foot()}`;
}, "themes");

route(/^\/t\/(\d+)/, async (no) => {
  view.innerHTML = `<div class="loading">테마 불러오는 중…</div>`;
  const [T] = await Promise.all([getJSON(DATA + "themes.json", 3600000), loadIndex().catch(() => null)]);
  const t = T.find((x) => String(x.no) === no);
  if (!t) return `<div class="empty">테마를 찾지 못했어요.</div>`;
  const won2 = (v) => (v == null ? "-" : v >= 1e12 ? (v / 1e12).toFixed(1) + "조" : Math.round(v / 1e8).toLocaleString("ko-KR") + "억");
  const reason = (r, s) => r === "L" ? `시가총액 ${won2(s[3])} (테마 1위)`
    : r === "M" ? (s[5] != null ? `최근 3개월 테마가 오른 날 테마 평균보다 ${s[5] > 0 ? "+" : ""}${(s[5] * 100).toFixed(1)}%p 더 움직였어요` : "최근 테마 상승일에 가장 강했어요")
    : (s[6] != null ? `최근 5일 거래대금이 평소의 ${s[6].toFixed(1)}배 · 매수세 강함` : "거래대금 증가와 매수세가 가장 강해요");
  const leaders = ["L", "M", "F"].map((r) => {
    const s = t.stocks.find((x) => x[4].includes(r));
    return s ? `<a class="role" href="#/s/${s[0]}"><span class="em">${ROLE[r][0]}</span><div style="flex:1;min-width:0"><b>${ROLE[r][1]} · ${esc(s[1])}</b>
      <div class="muted small">${esc(reason(r, s))}</div></div><span class="${cls(s[2])}">${pctTxt(s[2])}</span></a>` : "";
  }).join("");
  const stocks = [...t.stocks].sort((a, b) => (b[2] ?? -999) - (a[2] ?? -999));
  const st = t.stat || {};
  const statLines = [["up", "🔴 호재", "오른"], ["down", "🔵 악재", "내린"]].map(([k, w, v]) => {
    if (!st[k + "_days"] || st[k + "_eff"] == null) return "";
    let s = `${w} 소식이 나온 날(${st[k + "_days"]}일) 테마 평균 ${st[k + "_eff"] > 0 ? "+" : ""}${(st[k + "_eff"] * 100).toFixed(1)}%p (평소 대비) · 영향 강도 <b>${esc(st[k + "_strength"] || "-")}</b>`;
    const mv = st[k + "_mover"];
    if (mv) s += ` · 가장 크게 ${v} 종목: <b>${esc((BYCODE.get(mv) || {}).name || mv)}</b>${st[k + "_mover_avg"] != null ? ` (${(st[k + "_mover_avg"] * 100).toFixed(1)}%)` : ""}`;
    return `<li>${s}</li>`;
  }).join("");
  return `<div class="card"><div class="head"><h1>${esc(t.name)}</h1><b class="${cls(t.chg)}" style="font-size:20px">${pctTxt(t.chg)}</b></div>
    ${t.desc ? `<details style="margin-top:6px"><summary class="small muted" style="font-weight:400">테마 설명 보기</summary><p class="small">${esc(t.desc)}</p></details>` : ""}</div>
  ${leaders ? `<div class="card"><h2>🏆 대장주</h2><div class="roles">${leaders}</div></div>` : ""}
  <div class="card"><div class="toolbar" style="justify-content:space-between"><b>종목 ${stocks.length}개</b>${segH()}</div>
    ${stocks.map((s) => {
      const ix = BYCODE.get(s[0]) || { code: s[0], name: s[1] };
      return `<a class="row" href="#/s/${s[0]}"><div class="nm"><b>${[...s[4]].map((r) => ROLE[r][0]).join("")}${esc(s[1])}</b>
        <small>${esc(s[7] || "")}</small></div><div class="rt"><span class="${cls(s[2])}">${pctTxt(s[2])}</span><br>${pill(ix["p" + H])}</div></a>`;
    }).join("")}
    <p class="muted small">위 숫자 = 오늘 등락률 · 아래 = ${H}일 뒤 AI 상승 확률</p></div>
  <div class="card news"><h2>📰 테마 소식</h2>${t.news && t.news.length ? t.news.slice(0, 5).map((n) =>
    `<a href="${esc(n.u)}" target="_blank" rel="noopener"><span class="tag ${n.s > 0 ? "p" : n.s < 0 ? "n" : "z"}">${n.s > 0 ? "호재" : n.s < 0 ? "악재" : "중립"}</span>${esc(n.t)}
      <br><small>${esc(n.src)} · ${esc(String(n.w).slice(5, 16))}</small></a>`).join("") : `<div class="muted small">최근 소식이 없어요.</div>`}
    ${statLines ? `<p class="small" style="margin:10px 0 4px"><b>🔎 과거 1년 분석</b></p><ul class="small" style="margin:0;padding-left:18px">${statLines}</ul>` : ""}
    ${st.adj && Math.abs(st.adj) >= 0.0005 ? `<p class="muted small">📈 최근 소식을 바탕으로 이 테마 종목 확률에 ${st.adj > 0 ? "+" : ""}${(st.adj * 100).toFixed(1)}%p(1일 뒤 기준)를 더했어요.</p>` : ""}
    <p class="muted small">영향 강도: 소식이 나온 날 테마 평균 등락이 평소보다 얼마나 컸는지. 과거 결과가 앞으로를 보장하지 않아요.</p></div>${foot()}`;
}, "themes");

// ───────── ⭐ 내 종목 ─────────
route(/^\/my/, async () => {
  await Promise.all([loadIndex(), loadLive()]);
  const f = favs().map((c) => BYCODE.get(c)).filter(Boolean);
  after(() => document.querySelectorAll("[data-del]").forEach((b) => b.onclick = (e) => {
    e.preventDefault(); toggleFav(b.dataset.del); render();
  }));
  return `<div class="toolbar">${segH()}<span class="muted small">${esc(liveLabel())}</span></div>
  <div class="card"><h2>⭐ 내 종목 <small>${f.length}개</small></h2>
  ${f.length ? f.map((s) => `<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;min-width:0">${stockRow(s)}</div>
    <button class="icon-btn" data-del="${s.code}" aria-label="빼기" style="padding:4px 8px">✕</button></div>`).join("")
    : `<div class="empty">아직 담은 종목이 없어요.<br>종목 화면 오른쪽 위 ☆를 누르면 여기에 모여요.</div>`}</div>
  <p class="muted small">내 종목은 이 휴대폰(브라우저)에만 저장돼요. 서버로 보내지 않아요.</p>${foot()}`;
}, "my");

// ───────── ☰ 더보기 ─────────
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });
route(/^\/more/, async () => {
  await loadIndex().catch(() => null);
  const th = store.get("ss-theme", "auto");
  after(() => {
    document.querySelectorAll("[data-th]").forEach((b) => b.onclick = () => { store.set("ss-theme", b.dataset.th); applyTheme(); render(); });
    const ib = $("#install");
    if (ib) ib.onclick = async () => { if (installEvt) { installEvt.prompt(); installEvt = null; } };
    $("#refresh").onclick = () => { memo.clear(); INDEX = null; toast("새로 불러왔어요"); location.hash = "#/"; render(); };
  });
  const link = (u, t) => `<a class="row" href="${u}"><div class="nm"><b>${t}</b></div><span class="muted">›</span></a>`;
  return `<div class="card"><h2>⚙️ 설정</h2>
    <div class="row"><div class="nm"><b>화면 색</b></div><div class="seg">${[["auto", "자동"], ["light", "밝게"], ["dark", "어둡게"]]
      .map(([v, l]) => `<button data-th="${v}" class="${v === th ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="row"><div class="nm"><b>기본 예측 기간</b></div>${segH()}</div>
    <div class="row"><div class="nm"><b>자료 새로 받기</b><small>AI 기준일 ${esc(META?.date || "-")} · 계산 ${esc(META?.built_at || "-")}</small></div><button class="icon-btn" id="refresh">새로 고침</button></div>
    ${installEvt ? `<div class="row"><div class="nm"><b>홈 화면에 앱 추가</b></div><button class="icon-btn" id="install">추가</button></div>` : ""}</div>
  <div class="card"><h2>📚 알아보기</h2>
    ${link("/guide.html", "사용 설명서")}${link("/ai-probability.html", "AI 확률은 어떻게 계산하나요?")}${link("/hit-rate.html", "적중률 보는 법")}
    ${link("/research.html", "연구 기록 (무엇을 시험했나)")}${link("/faq.html", "자주 묻는 질문")}</div>
  <div class="card"><h2>ℹ️ 정보</h2>${link("/about.html", "스톡시그널 소개·문의")}${link("/privacy.html", "개인정보처리방침")}${link("/disclaimer.html", "면책 고지")}
    <p class="muted small">버전 ${VERSION} · 시세: 네이버 증권 · 뉴스: Google 뉴스</p></div>${foot()}`;
}, "more");

// ───────── 시작 ─────────
render();
lastHash = location.hash;
setInterval(() => {  // 장중엔 5분마다 현재가 다시 받기 (화면 보고 있을 때만)
  if (document.hidden) return;
  const h = new Date(Date.now() + 9 * 3600e3);
  const hm = h.getUTCHours() * 100 + h.getUTCMinutes(), wd = h.getUTCDay();
  if (wd === 0 || wd === 6 || hm < 900 || hm > 1600) return;
  loadLive(true).then(() => { if (/^(#\/?|#\/rank|#\/my)?$/.test(location.hash) && !document.querySelector("#q:focus")) render(); });
}, 300000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

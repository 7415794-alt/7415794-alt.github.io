/* 스톡시그널 앱 v2.2.0
   - 매일 오후 5시에 계산해 둔 파일(AI 확률·차트·뉴스·테마)과 장중 20분마다 모은 현재가를 읽어서 바로 보여 줌.
   - 서버 계산이 없어서 빠르고, 한 번 본 자료는 인터넷이 끊겨도 다시 볼 수 있음. */
"use strict";
const VERSION = "2.2.0";
const QS = new URLSearchParams(location.search);
const DATA = QS.get("data") || "https://raw.githubusercontent.com/7415794-alt/stock-ai/data/app/";
const LIVE = QS.get("live") || "https://raw.githubusercontent.com/7415794-alt/stock-ai/live/live.json";
const IDXP = QS.get("idx") || "https://raw.githubusercontent.com/7415794-alt/stock-ai/idx/index.json";
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
    <div class="nm"><b>${esc(s.name)}${flags}${opt.move ? moveTxt(s.code, opt.move) : ""}</b><small>${sub}</small></div>
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
  <a href="/disclaimer.html">면책 고지</a> · <a href="/privacy.html">개인정보처리방침</a> · 문의 <a href="mailto:slakeknowledge@gmail.com">slakeknowledge@gmail.com</a> · v${VERSION}</p>`;

// ───────── 전체 메뉴 (예전 앱의 8가지 화면) ─────────
const CATS = [["#/", "🔍", "분석"], ["#/my", "💼", "내 종목"], ["#/themes", "🧩", "테마"], ["#/screen", "🔎", "조건검색"],
  ["#/rank?up", "🏆", "확률순위"], ["#/rank?best", "🎯", "적중순위"], ["#/cmp", "🆚", "비교"], ["#/market", "🌏", "시장 분위기"]];
const catBar = () => `<div class="cats">${CATS.map(([u, e, l]) => `<a href="${u}"><b>${e}</b>${l}</a>`).join("")}</div>`;
const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const yymmdd = (iso) => +iso.slice(2).replace(/-/g, "");
function marketState() {
  const v = LIVEJ && LIVEJ.idx && LIVEJ.idx.KOSPI;
  if (!v) return "";
  return v[2] === "OPEN" ? "🟢 장 중" : "🔴 장 마감";
}

// 적중률 순위: 같은 기간 전 종목 중 상위 몇 %
const hitPool = {};
function hitTop(hr, h = H) {
  if (hr == null || !INDEX) return null;
  if (!hitPool[h]) hitPool[h] = INDEX.map((s) => s["hr" + h]).filter((v) => v != null);
  const pool = hitPool[h];
  if (!pool.length) return null;
  return Math.max(1, Math.round((pool.filter((v) => v > hr).length + 1) / pool.length * 100));
}
// 어제 순위와 비교: ▲3 / ▼2 / - / 🆕 (차트 AI 확률 기준, 전 종목)
const orderMemo = {};
function orderMap(key, desc) {
  const id = key + desc;
  if (!orderMemo[id]) {
    const l = INDEX.filter((s) => s[key] != null && !s.halted).sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key]));
    orderMemo[id] = new Map(l.map((s, i) => [s.code, i + 1]));
  }
  return orderMemo[id];
}
function moveTxt(code, kind) {
  if (!META || !META.prev_date) return "";
  const desc = kind !== "down";
  const now = orderMap("a" + H, desc).get(code), old = orderMap("q" + H, desc).get(code);
  if (now == null) return "";
  if (old == null) return `<span class="mv new">🆕</span>`;
  const d = old - now;
  return d > 0 ? `<span class="mv up">▲${d}</span>` : d < 0 ? `<span class="mv down">▼${-d}</span>` : `<span class="mv">-</span>`;
}
function newsMood(score) {
  return score >= 0.3 ? "😀 긍정적" : score >= 0.1 ? "🙂 조금 긍정적" : score <= -0.3 ? "😟 부정적" : score <= -0.1 ? "😕 조금 부정적" : "😐 중립";
}

// 어제 AI 성적표
async function scorecardHtml(compact) {
  let card;
  try { card = await getJSON(DATA + "scorecard.json", 3600000); } catch { return ""; }
  if (!card || !card.length) return "";
  const r = card[card.length - 1];
  const md = (x) => `${+x.slice(5, 7)}/${+x.slice(8, 10)}`;
  const pc = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  if (compact) {
    return `<a class="card" href="#/rank?up" style="display:block"><h2>📋 어제 AI 성적표 <small>${md(r.date)} 예측 → ${md(r.eval_date)} 결과 ›</small></h2>
      <div class="split">
      ${r.all_n ? `<div class="stat"><small>전 종목 적중률</small><b>${pc(r.all_hit, r.all_n)}%</b><div class="small muted">${won(r.all_n)}개 중 ${won(r.all_hit)}개 맞힘</div></div>` : ""}
      <div class="stat"><small>📈 상승 TOP 20</small><b>${pc(r.up_hit, r.up_n)}%</b><div class="small muted">${r.up_n}개 중 ${r.up_hit}개 실제 상승</div></div>
      <div class="stat"><small>📉 하락 TOP 20</small><b>${pc(r.down_hit, r.down_n)}%</b><div class="small muted">${r.down_n}개 중 ${r.down_hit}개 실제 하락</div></div></div>
      <p class="muted small" style="margin:8px 0 0">${r.all_n ? "전 종목 적중률 = '1거래일 뒤' 확률이 50% 이상이면 오른다, 미만이면 내린다로 보고 실제와 맞은 비율. " : ""}비교용: 그날 전체 종목 중 ${Math.round(r.all_up * 100)}%가 올랐어요.</p></a>`;
  }
  const last = card.slice(-20);
  const sum = (k) => last.reduce((a, x) => a + x[k], 0);
  return `<div class="card"><h2>📋 어제 AI 성적표 <small>${md(r.date)} 예측 → ${md(r.eval_date)} 결과</small></h2><div class="split">
    ${r.all_n ? `<div class="stat"><small>🎯 전 종목 적중률</small><b>${pc(r.all_hit, r.all_n)}%</b><div class="small muted">${won(r.all_n)}개 중 ${won(r.all_hit)}개 맞힘</div></div>` : ""}
    <div class="stat"><small>📈 상승 TOP 20</small><b>${r.up_hit}개 올랐어요</b><div class="small muted">${Math.round(r.up_hit / r.up_n * 100)}% 적중 · 평균 <span class="${cls(r.up_avg)}">${pctTxt(r.up_avg * 100, 1)}</span></div></div>
    <div class="stat"><small>📉 하락 TOP 20</small><b>${r.down_hit}개 내렸어요</b><div class="small muted">${Math.round(r.down_hit / r.down_n * 100)}% 적중 · 평균 ${pctTxt(r.down_avg * 100, 1)}</div></div>
    <div class="stat"><small>전체 종목 (비교용)</small><b>${Math.round(r.all_up * 100)}% 올랐어요</b><div class="small muted">평균 ${pctTxt(r.all_avg * 100, 1)}</div></div>
    ${card.length >= 2 ? `<div class="stat"><small>최근 ${last.length}일 평균</small><b>${Math.round(sum("up_hit") / sum("up_n") * 100)}% 적중</b><div class="small muted">상승 TOP 20 기준 · 전체 ${Math.round(sum("all_up") / last.length * 100)}%</div></div>` : ""}</div>
    ${card.length >= 2 ? `<details style="margin-top:8px"><summary class="small">날짜별 성적 보기</summary><table><tr><th>예측일</th><th class="r">전 종목</th><th class="r">상승 TOP 20</th><th class="r">하락 TOP 20</th><th class="r">전체 상승</th></tr>
      ${[...card].reverse().slice(0, 30).map((x) => `<tr><td>${md(x.date)}</td><td class="r">${x.all_n ? pc(x.all_hit, x.all_n) + "%" : "-"}</td><td class="r">${x.up_hit}/${x.up_n}</td><td class="r">${x.down_hit}/${x.down_n}</td><td class="r">${Math.round(x.all_up * 100)}%</td></tr>`).join("")}</table></details>` : ""}
    <p class="muted small">어제 '1거래일 뒤' 상승 확률 TOP 20 종목이 오늘 실제로 올랐는지(하락 TOP 20은 내렸는지) 매일 채점해요. 전체 종목 상승 비율보다 높아야 AI가 의미 있게 고른 거예요.</p></div>`;
}

// 선 그래프 여러 개 (AI 확률 변화, AI 따라 했다면, 시장 지수, 비교)
function drawLines(cv, labels, series, opt = {}) {
  if (!cv || !labels.length) return;
  const css = getComputedStyle(document.documentElement);
  const col = (v) => (v.startsWith("--") ? css.getPropertyValue(v).trim() : v);
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = opt.h || 200;
  cv.width = W * dpr; cv.height = Hh * dpr; cv.style.height = Hh + "px";
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const pad = { l: 4, r: 48, t: 8, b: 18 }, ph = Hh - pad.t - pad.b;
  const rng = {};
  for (const s of series) {
    const k = s.scale || "a";
    const v = s.v.filter((x) => x != null);
    if (!v.length) continue;
    rng[k] = rng[k] || [Infinity, -Infinity];
    rng[k][0] = Math.min(rng[k][0], ...v); rng[k][1] = Math.max(rng[k][1], ...v);
  }
  if (opt.fixA) rng.a = opt.fixA;
  for (const k in rng) if (rng[k][0] === rng[k][1]) { rng[k][0] -= 1; rng[k][1] += 1; }
  const x = (i) => pad.l + (W - pad.l - pad.r) * (labels.length === 1 ? 0.5 : i / (labels.length - 1));
  const y = (v, k) => pad.t + ph * (1 - (v - rng[k][0]) / (rng[k][1] - rng[k][0]));
  g.font = "11px sans-serif"; g.strokeStyle = col("--line"); g.fillStyle = col("--muted"); g.lineWidth = 1;
  if (rng.a) for (let i = 0; i <= 3; i++) {
    const v = rng.a[0] + (rng.a[1] - rng.a[0]) * i / 3, yy = y(v, "a");
    g.beginPath(); g.moveTo(pad.l, yy); g.lineTo(W - pad.r, yy); g.stroke();
    g.fillText(opt.fmt ? opt.fmt(v) : Math.round(v).toLocaleString("ko-KR"), W - pad.r + 4, yy + 4);
  }
  if (opt.ref != null && rng.a) {
    g.setLineDash([3, 3]); g.strokeStyle = col("--muted"); g.beginPath();
    g.moveTo(pad.l, y(opt.ref, "a")); g.lineTo(W - pad.r, y(opt.ref, "a")); g.stroke(); g.setLineDash([]);
  }
  for (const s of series) {
    const k = s.scale || "a";
    if (!rng[k]) continue;
    g.strokeStyle = col(s.color); g.lineWidth = s.w || 2; g.beginPath();
    let on = false;
    s.v.forEach((v, i) => { if (v == null) return; on ? g.lineTo(x(i), y(v, k)) : g.moveTo(x(i), y(v, k)); on = true; });
    g.stroke();
  }
  g.fillStyle = col("--muted");
  g.fillText(ymd(labels[0]), pad.l, Hh - 4);
  const last = ymd(labels[labels.length - 1]);
  g.fillText(last, W - pad.r - g.measureText(last).width, Hh - 4);
}
const legend = (items) => `<p class="muted small">${items.map(([c, t]) => `<span style="color:${c}">━</span> ${t}`).join(" · ")}</p>`;

// AI vs 나 (오른다/내린다 찍기) · 내가 산 종목 — 이 휴대폰에만 저장
(function importOldMore() {
  try {
    if (localStorage.getItem("ss-hold") == null) {
      const h = (localStorage.getItem("stock-ai-hold") || "").split(",").map((x) => x.split("~"))
        .filter((p) => p.length === 4 && /^\d{6}/.test(p[0])).map((p) => [p[0].slice(0, 6), p[1], +p[2], +p[3]]);
      store.set("ss-hold", h);
    }
    if (localStorage.getItem("ss-votes") == null) {
      const v = (localStorage.getItem("stock-ai-votes") || "").split(",").map((x) => x.split("~"))
        .filter((p) => p.length === 7 && /^\d{6}/.test(p[0])).map((p) => [p[0].slice(0, 6), p[1], +p[2], p[3], +p[4], p[5], +p[6]]);
      store.set("ss-votes", v);
    }
    if (localStorage.getItem("ss-recent") == null) store.set("ss-recent", codesFrom(localStorage.getItem("stock-ai-recent")));
  } catch { /* 예전 기록 없음 */ }
})();
const votes = () => store.get("ss-votes", []);
function addVote(code, name, h, price, me, ai) {
  const v = votes().filter((x) => !(x[0] === code && x[2] === h && x[3] === todayKST()));
  v.unshift([code, name, h, todayKST(), price, me, ai]);
  store.set("ss-votes", v.slice(0, 60));
}
const holds = () => store.get("ss-hold", []);

// 관심 종목: 어제보다 AI 확률이 많이 바뀐 종목을 위로 (🔥 = 5%p 이상)
function favList(limit, del) {
  const rows = favs().map((c) => BYCODE.get(c)).filter(Boolean).map((s) => {
    const a = s["a" + H], q = s["q" + H];
    return [s, a != null && q != null ? (a - q) * 100 : null];
  });
  if (!rows.length) return `<div class="muted small">아직 관심 종목이 없어요. 종목 화면 오른쪽 위 ☆를 누르면 여기에 모여요.</div>`;
  rows.sort((x, y) => (y[1] == null ? 0 : Math.abs(y[1])) - (x[1] == null ? 0 : Math.abs(x[1])));
  return rows.slice(0, limit || 99).map(([s, d]) => {
    const pr = priceOf(s);
    let chg = "";
    if (d != null) chg = Math.abs(d) < 0.05 ? " · 어제와 같음" : ` · 어제보다 <span class="${cls(d)}">${d > 0 ? "▲" : "▼"}${Math.abs(d).toFixed(1)}%p</span>`;
    const row = stockRow(s, { sub: `${Math.abs(d || 0) >= 5 ? "🔥 " : ""}${won(pr.now)}원 <span class="${cls(pr.chg)}">${pctTxt(pr.chg)}</span>${chg}` });
    return del ? `<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;min-width:0">${row}</div>
      <button class="icon-btn" data-del="${s.code}" aria-label="빼기" style="padding:4px 8px">✕</button></div>` : row;
  }).join("") + (META && META.prev_date ? `<p class="muted small">어제보다 AI 확률이 많이 바뀐 종목이 위로 와요. 🔥 = 5%p 이상 변화</p>` : "");
}

// 코스피·코스닥 오를 확률 (평일 아침, 어젯밤 미국 증시까지 반영해 계산)
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const mdOf = (x) => `${+x.slice(5, 7)}/${+x.slice(8, 10)}`;
const idxHit = (p, r) => (r == null || r === 0 ? null : (p >= 0.5) === (r > 0));
function idxProb(j, k) {
  const x = j && j[k];
  if (!x) return "";
  const today = kstToday(), pp = Math.round(x.p * 100);
  const v = LIVEJ && LIVEJ.idx && LIVEJ.idx[k];
  const liveToday = LIVEJ && LIVEJ.t.slice(0, 10) === today;
  const mark = (h) => (h == null ? "" : h ? " ✅ 맞음" : " ❌ 틀림");
  if (x.for === today && v && v[2] !== "OPEN" && liveToday) // 오늘 장이 끝남 → 채점
    return `<div class="small">🤖 오늘 예측 ${pp}%${mark(idxHit(x.p, v[1]))}</div>`;
  if (x.for >= today) return `<div class="small">🤖 ${x.for === today ? "오늘" : mdOf(x.for)} 오를 확률 <b class="${x.p >= 0.5 ? "up" : "down"}">${pp}%</b></div>`;
  const h = (j.hist || []).find((y) => y.k === k && y.for === x.for);
  return `<div class="small muted">🤖 ${mdOf(x.for)} 예측 ${pp}%${mark(h && idxHit(x.p, h.r))}</div>`;
}
function idxNote(j) {
  if (!j || !j.KOSPI) return "";
  const today = kstToday();
  const done = (j.hist || []).filter((y) => y.r != null && y.r !== 0);
  const hits = done.filter((y) => idxHit(y.p, y.r)).length;
  const a = (k) => (j[k] ? `${Math.round(j[k].acc * 100)}%` : "-"), b = (k) => (j[k] ? `${Math.round(j[k].base_acc * 100)}%` : "-");
  const later = j.KOSPI.for <= today && !(j.KOSPI.for === today && marketState().includes("장 중"));
  return `<p class="muted small" style="margin:8px 0 0">🤖 = AI가 본 '오늘 장 마감이 어제보다 오를 확률'. 어젯밤 미국 증시 마감까지 반영해 평일 아침 7시쯤 계산해요${later ? " (다음 확률은 다음 거래일 아침에 나와요)" : ""}.
    과거 10년 시험 적중률 코스피 ${a("KOSPI")}·코스닥 ${a("KOSDAQ")} (늘 '오른다'고 하면 ${b("KOSPI")}·${b("KOSDAQ")})${done.length ? ` · 실제 기록 ${done.length}번 중 ${hits}번 맞힘` : ""}.</p>`;
}

// ───────── 🏠 홈 ─────────
route(/^\/$/, async () => {
  const [, , ij] = await Promise.all([loadIndex(), loadLive(), getJSON(IDXP, 600000).catch(() => null)]);
  const idx = (LIVEJ && LIVEJ.idx) || {};
  const mk = ["KOSPI", "KOSDAQ"].map((k) => {
    const v = idx[k];
    return `<div class="stat"><small>${k === "KOSPI" ? "코스피" : "코스닥"}</small>
      <b>${v ? v[0].toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "-"}</b>
      <div class="${cls(v && v[1])}">${v ? pctTxt(v[1]) : ""}</div>${idxProb(ij, k)}</div>`;
  }).join("");
  const ok = INDEX.filter((s) => s["p" + H] != null && !s.managed && !s.alert && !s.halted);
  const top = [...ok].sort((a, b) => b["p" + H] - a["p" + H]).slice(0, 10);
  const rec = store.get("ss-recent", []).map((c) => BYCODE.get(c)).filter(Boolean).slice(0, 5);
  const sc = await scorecardHtml(true);
  return `
  ${catBar()}
  <a class="card" href="#/market" style="display:block"><h2>📊 오늘 시장 <small>${esc(marketState())} · ${esc(liveLabel())} ›</small></h2><div class="mkt">${mk}</div>${idxNote(ij)}</a>
  ${sc}
  <div class="toolbar">${segH()}<span class="muted small">AI 기준일 ${esc(META?.date || "-")}</span></div>
  <div class="card"><h2>⭐ 관심 종목 <a class="small muted" href="#/my">전체 ›</a></h2>${favList(5)}</div>
  <div class="card"><h2>🔥 ${H}일 뒤 상승 확률 TOP 10 <a class="small muted" href="#/rank?up">더 보기 ›</a></h2>
    ${top.map((s, i) => stockRow(s, { rank: i + 1, move: "up" })).join("")}
    <p class="muted small">관리종목·투자주의 종목·거래정지 종목은 뺐어요. 적중 = 최근 60번 예측 중 맞힌 비율. ▲▼ = 어제 순위와 비교.</p></div>
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

  // 한 줄 요약 + 핵심 3가지 + AI 따라 했다면
  const top = hitTop(hr != null && ST.n >= 60 ? hr : null);
  const nscore = ((d.prob["1"] || d.prob[1] || {}).news || 0) / 0.06;
  const mood = d.news && d.news.length ? newsMood(nscore) : "없음";
  const FL = (d.follow || {})[H] || (d.follow || {})[String(H)];
  let sumHtml = "";
  if (P) {
    const up = P.p * 100;
    const dir = up >= 55 ? "오를 가능성을 더 높게" : up <= 45 ? "내릴 가능성을 더 높게" : "오를지 내릴지 비슷하게";
    const hitTxt = top == null ? (hr != null ? `최근 ${ST.n}번 중 ${Math.round(hr * 100)}%를 맞혔어요.` : "")
      : top <= 30 ? `최근 적중률이 전체 종목 중 <b>상위 ${top}%</b>로 좋은 편이에요.`
      : top >= 70 ? `다만 최근 적중률이 전체 종목 중 <b>상위 ${top}%</b>(하위권)라 참고만 하세요.`
      : `최근 적중률은 전체 종목 중 상위 ${top}%로 중간 정도예요.`;
    sumHtml = `<div class="sumbox">💡 AI는 이 종목이 ${H}거래일 뒤 <b>${dir}</b> 보고 있어요. ${hitTxt}</div>
      <div class="kv3"><div><small>최근 적중률</small><b>${hr != null ? Math.round(hr * 100) + "%" : "-"}</b></div>
      <div><small>적중률 순위</small><b>${top ? `상위 ${top}%` : "-"}</b></div><div><small>뉴스</small><b>${esc(mood.split(" ").pop())}</b></div></div>
      ${FL ? `<div class="follow">🧪 최근 1년 <b>AI 따라 했다면 <span class="${cls(FL.s)}">${pctTxt(FL.s * 100, 1)}</span></b> · 그냥 갖고 있었다면 ${pctTxt(FL.hd * 100, 1)} <small class="muted">(자세히: AI 성적)</small></div>` : ""}`;
  }

  // AI vs 나
  const myVote = votes().find((v) => v[0] === code && v[2] === H && v[3] === todayKST());
  const voteHtml = !P ? "" : myVote
    ? `<div class="card vs">🗳 <b>AI vs 나</b> · 나: <b>${myVote[5] === "u" ? "📈 오른다" : "📉 내린다"}</b> · AI: <b>${myVote[6] >= 50 ? "📈 오른다" : "📉 내린다"}</b> (${myVote[6]}%)
       <br><small class="muted">${H}거래일 뒤 누가 맞혔는지 💼 내 종목 화면에서 채점해요.</small></div>`
    : `<div class="card"><b>🗳 AI vs 나</b> · <span class="small">${H}거래일 뒤 이 종목, 나는 어떻게 생각해요?</span>
       <div class="split" style="margin-top:8px"><button class="more" data-vote="u">📈 오른다</button><button class="more" data-vote="d">📉 내린다</button></div></div>`;

  // AI 확률 변화 · 따라 했다면 · 최근 10번
  const trAll = d.track[H] || d.track[String(H)] || [];
  const last10 = trAll.slice(-11, -1).reverse();
  const moreAi = `<details id="aibox" style="margin-top:10px"><summary>📊 AI 확률 변화 · 따라 했다면 · 최근 예측 표</summary>
    <p class="small" style="margin:8px 0 2px"><b>📈 AI 확률 변화 (최근 ${trAll.length}거래일)</b></p><canvas id="pchart"></canvas>
    ${legend([["var(--up)", "상승 확률(왼쪽 %)"], ["#9aa3b5", "주가"]])}
    <p class="muted small">선이 50% 위면 AI가 '상승', 아래면 '하락'으로 본 날이에요. 그날까지의 자료로만 계산한 확률이에요(뉴스 미반영).</p>
    ${FL ? `<p class="small" style="margin:10px 0 2px"><b>🧪 AI 따라 했다면? (최근 1년)</b></p>
      <div class="split"><div class="stat"><small>AI 따라 했다면</small><b class="${cls(FL.s)}">${pctTxt(FL.s * 100, 1)}</b><div class="small muted">${FL.n}번 중 ${FL.b}번 삼</div></div>
      <div class="stat"><small>그냥 갖고 있었다면</small><b class="${cls(FL.hd)}">${pctTxt(FL.hd * 100, 1)}</b><div class="small muted">비교용</div></div></div>
      <canvas id="fchart"></canvas>${legend([["var(--up)", "AI 따라 하기"], ["#9aa3b5", "그냥 보유"]])}
      <p class="muted small">${H}거래일마다 AI가 '상승'(50% 이상)이면 사서 ${H}거래일 들고 있고, '하락'이면 쉬었다고 가정했어요. 수수료·세금은 빼지 않았고 과거 결과일 뿐이에요.</p>` : ""}
    ${last10.length ? `<p class="small" style="margin:10px 0 2px"><b>🎯 최근 10번 예측</b></p><table><tr><th>날짜</th><th>AI 예측</th><th class="r">실제</th><th class="r">결과</th></tr>
      ${last10.map(([dt, p, r]) => `<tr><td>${ymd(dt).slice(3)}</td><td>${p >= 0.5 ? "📈" : "📉"} ${Math.round(p * 100)}%</td><td class="r ${cls(r)}">${r == null ? "-" : pctTxt(r * 100, 1)}</td>
        <td class="r">${r == null ? "⏳" : (p >= 0.5) === (r > 0) ? "✅" : "❌"}</td></tr>`).join("")}</table>
      <p class="muted small">상승 확률 50% 이상이면 '상승' 예측이에요. 예측한 날 종가와 ${H}거래일 뒤 종가를 비교해요. ⏳ = 아직 기간이 안 끝남.</p>` : ""}</details>`;

  // 증권사 목표주가 · 외국인/기관 매매 · 실적 발표 일정 · 기본 정보
  const info = d.info || {};
  const infoHtml = Object.keys(info).length ? `<div class="fin">${Object.entries(info).map(([k, v]) => `<div class="stat"><small>${esc(k)}</small><b style="font-size:14px">${esc(v)}</b></div>`).join("")}</div>` : "";
  let consHtml = `<p class="muted small">이 종목은 증권사 목표주가가 없어요. (작은 회사는 분석하는 증권사가 없는 경우가 많아요)</p>`;
  if (d.cons && d.cons.target) {
    const gap = d.cons.target / pr.now - 1;
    consHtml = `<div class="split"><div class="stat"><small>평균 목표주가</small><b>${won(d.cons.target)}원</b><div class="small muted">${esc(d.cons.date || "")}</div></div>
      <div class="stat"><small>현재가 대비</small><b class="${cls(gap)}">${pctTxt(gap * 100, 1)}</b><div class="small muted">${gap > 0 ? "더 오를 여지" : "이미 목표 넘음"}</div></div>
      <div class="stat"><small>투자의견</small><b>${esc(d.cons.op)}</b><div class="small muted">증권사 평균</div></div></div>
      <p class="muted small">증권사 애널리스트 목표주가 평균(네이버 증권)이에요. 자주 바뀌고 틀리는 경우도 많으니 참고만 하세요.</p>`;
  }
  const deal = d.deal || [];
  const dealHtml = deal.length ? `<div class="split">${["외국인", "기관", "개인"].map((w, i) => {
    const s = deal.reduce((a, r) => a + (r[i + 1] || 0), 0);
    return `<div class="stat"><small>${w}</small><b class="${cls(s)}">${s > 0 ? "+" : ""}${won(s)}주</b><div class="small muted">최근 ${deal.length}거래일 · ${s > 0 ? "샀어요" : s < 0 ? "팔았어요" : "그대로"}</div></div>`;
  }).join("")}</div><table style="margin-top:6px"><tr><th>날짜</th><th class="r">외국인</th><th class="r">기관</th><th class="r">개인</th></tr>
    ${[...deal].reverse().map((r) => `<tr><td>${ymd(r[0]).slice(3)}</td>${[1, 2, 3].map((i) => `<td class="r ${cls(r[i])}">${r[i] > 0 ? "+" : ""}${won(r[i])}</td>`).join("")}</tr>`).join("")}</table>
    <p class="muted small">+ = 산 주식이 더 많음(순매수), − = 판 주식이 더 많음(순매도). 네이버 증권 자료, 오후 5시 기준.</p>` : `<p class="muted small">매매 정보가 없어요.</p>`;
  let irHtml = `<p class="muted small">알려진 일정이 없어요.</p>`;
  if (d.ir) {
    const dd = Math.round((new Date(d.ir[1]) - new Date(todayKST())) / 864e5);
    irHtml = `<p class="small">📢 ${esc(d.ir[0])} · <b>${esc(d.ir[1])}</b> (${dd === 0 ? "오늘" : dd > 0 ? "D-" + dd : "지난 일정"})</p>`;
  }

  // 기업 정보
  const f = d.fin || {};
  const n = (k) => (f[k] == null ? null : parseFloat(String(f[k]).replace(/,/g, "")));
  const finItems = [["PER", n("per"), (v) => v.toFixed(1) + "배"], ["PBR", n("pbr"), (v) => v.toFixed(2) + "배"], ["ROE", n("roe"), (v) => v.toFixed(1) + "%"],
    ["배당수익률", n("dividendRate"), (v) => v.toFixed(2) + "%"], ["매출 성장률", n("salesIncreasingRate"), (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "%"],
    ["영업이익 성장률", n("operatingProfitIncreasingRate"), (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "%"]];
  const prop = n("propertyTotal"), debt = n("debtTotal");
  if (prop && debt != null && prop - debt > 0) finItems.push(["부채비율", debt / (prop - debt) * 100, (v) => v.toFixed(0) + "%"]);
  if (n("sales")) finItems.push(["매출액", n("sales"), (v) => (v >= 10000 ? (v / 10000).toFixed(1) + "조" : v.toLocaleString("ko-KR") + "억")]);
  const finRows = finItems.filter((x) => !(x[0] in info));
  const finGrid = finRows.some((x) => x[1] != null && !isNaN(x[1])) ? `<p class="small" style="margin:10px 0 4px"><b>📑 실적·재무</b></p><div class="fin">${finRows.filter((x) => x[1] != null && !isNaN(x[1]))
    .map(([k, v, fm]) => `<div class="stat"><small>${k}</small><b style="font-size:15px">${fm(v)}</b></div>`).join("")}</div>` : "";
  const finHtml = `<div class="card"><h2>🏢 기업 정보</h2>${infoHtml}${finGrid}
    <p class="small" style="margin:12px 0 4px"><b>🎯 증권사 목표주가</b></p>${consHtml}
    <p class="small" style="margin:12px 0 4px"><b>🧑‍🤝‍🧑 외국인·기관 매매</b></p>${dealHtml}
    <p class="small" style="margin:12px 0 4px"><b>📅 실적 발표 일정</b></p>${irHtml}
    <p class="muted small">네이버 증권 자료(매일 오후 5시 기준). 적자 기업은 PER이 '-'로 나와요. AI 확률 계산에는 쓰지 않는 참고 정보예요.</p></div>`;

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
    document.querySelectorAll("[data-vote]").forEach((b) => b.onclick = () => {
      addVote(code, d.name, H, pr.now, b.dataset.vote, Math.round(P.p * 100));
      toast("찍었어요! 기간이 지나면 내 종목 화면에서 채점해요");
      render();
    });
    $("#aibox").addEventListener("toggle", (e) => {
      if (!e.target.open) return;
      const cmap = new Map(d.chart.d.map((x, i) => [x, d.chart.c[i]]));
      drawLines($("#pchart"), trAll.map((r) => r[0]), [
        { v: trAll.map((r) => cmap.get(r[0]) ?? null), color: "#9aa3b5", w: 1, scale: "b" },
        { v: trAll.map((r) => r[1] * 100), color: "--up", w: 2 }], { fixA: [0, 100], ref: 50, fmt: (v) => Math.round(v) + "%", h: 190 });
      if (FL) drawLines($("#fchart"), FL.c.map((r) => r[0]), [
        { v: FL.c.map((r) => r[2] * 100), color: "#9aa3b5", w: 1 }, { v: FL.c.map((r) => r[1] * 100), color: "--up", w: 2 }],
        { ref: 0, fmt: (v) => Math.round(v) + "%", h: 180 });
    });
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
    <p class="muted small" style="text-align:center">AI 기준일 ${esc(d.date)} 종가 · 매일 오후 5시 새로 계산</p>${sumHtml}
    <a class="more" href="#/cmp?${code}-" style="text-align:center">🆚 다른 종목과 비교하기</a></div>
  <div class="card"><h2>📈 주가 <span class="seg">${[[60, "3개월"], [120, "6개월"], [260, "1년"]].map(([k, l]) => `<button data-range="${k}" class="${k === rg ? "on" : ""}">${l}</button>`).join("")}</span></h2>
    <canvas id="chart" height="230"></canvas><p class="muted small" id="chartinfo">선 = 종가 · <span style="color:#f59e0b">주황</span> 20일 평균 · <span style="color:#8b5cf6">보라</span> 60일 평균 · 아래 막대 = 거래량</p></div>
  ${voteHtml}
  <div class="card"><h2>🎯 이 종목 AI 성적 <small>${H}일 뒤</small></h2>${statHtml}${trackHtml}${moreAi}</div>
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
route(/^\/rank(?:\?(\w+))?/, async (by) => {
  if (by === "hit") by = "best";
  if (by && ["up", "down", "best", "worst"].includes(by) && by !== rankState.by) { rankState.by = by; rankShow = 50; store.set("ss-rank", rankState); }
  if (!["up", "down", "best", "worst"].includes(rankState.by)) rankState.by = "up";
  await Promise.all([loadIndex(), loadLive()]);
  const k = "p" + H, hk = "hr" + H;
  let list = INDEX.filter((s) => s[k] != null && !s.halted);
  if (rankState.mkt !== "ALL") list = list.filter((s) => s.market === rankState.mkt);
  if (rankState.safe) list = list.filter((s) => !s.managed && !s.alert);
  if (rankState.by === "up") list.sort((a, b) => b[k] - a[k]);
  else if (rankState.by === "down") list.sort((a, b) => a[k] - b[k]);
  else {
    list = list.filter((s) => s[hk] != null).sort((a, b) => b[hk] - a[hk] || Math.abs(b[k] - 0.5) - Math.abs(a[k] - 0.5));
    if (rankState.by === "worst") list.reverse();
  }
  const sc = rankState.by === "up" ? await scorecardHtml(false) : "";
  const mv = ["up", "down"].includes(rankState.by) ? rankState.by : null;
  const seg = (name, opts, cur) => `<div class="seg" data-rk="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${l}</button>`).join("")}</div>`;
  after(() => {
    document.querySelectorAll("[data-rk] button").forEach((b) => b.onclick = () => {
      const key = b.parentElement.dataset.rk;
      rankState[key] = b.dataset.v; store.set("ss-rank", rankState); rankShow = 50;
      if (key === "by") location.hash = `#/rank?${b.dataset.v}`; else render();
    });
    $("#safe").onchange = (e) => { rankState.safe = e.target.checked; store.set("ss-rank", rankState); render(); };
    const m = $("#rkmore"); if (m) m.onclick = () => { rankShow += 50; render(); };
  });
  const title = { up: "📈 오를 확률 높은 순", down: "📉 내릴 확률 높은 순", best: "🥇 AI 적중률 높은 순", worst: "🥶 AI 적중률 낮은 순" }[rankState.by];
  return `<div class="toolbar">${seg("by", [["up", "🏆 상승"], ["down", "하락"], ["best", "🎯 적중 상위"], ["worst", "적중 하위"]], rankState.by)}</div>
  <div class="toolbar">${segH()}<a class="chip" href="#/screen">🔎 조건검색 ›</a></div>
  <div class="toolbar">${seg("mkt", [["ALL", "전체"], ["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]], rankState.mkt)}
    <label class="ck"><input type="checkbox" id="safe" ${rankState.safe ? "checked" : ""}> 관리·주의 종목 빼기</label></div>
  <div class="card"><h2>${H}일 뒤 ${title} <small>${list.length.toLocaleString("ko-KR")}종목</small></h2>
    ${list.slice(0, rankShow).map((s, i) => stockRow(s, { rank: i + 1, move: mv })).join("")}
    ${list.length > rankShow ? `<button class="more" id="rkmore">50개 더 보기</button>` : ""}
    <p class="muted small">확률 = AI + 뉴스 + 테마 소식 반영 · 적중 = 최근 60번 예측(50% 이상이면 상승) 중 맞힌 비율${mv && META?.prev_date ? ` · ▲▼ = ${esc(META.prev_date)} 순위와 비교(차트 AI 기준), 🆕 = 새로 들어옴` : ""}
    · AI 기준일 ${esc(META?.date || "-")}. 높은 순서일 뿐 실제로 오르거나 내린다는 보장은 없어요.</p></div>${sc}${foot()}`;
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
  // 💼 내가 산 종목
  const hs = holds();
  let tb = 0, tn = 0;
  const hrows = hs.map(([c, name, price, qty]) => {
    const s = BYCODE.get(c) || { code: c, name };
    const now = priceOf(s).now;
    if (now != null) { tb += price * qty; tn += now * qty; }
    const r = now != null ? now / price - 1 : null;
    const body = now == null ? "현재가를 못 불러왔어요"
      : `${r > 0 ? "🔺" : r < 0 ? "🔹" : ""} <b class="${cls(r)}">${pctTxt(r * 100, 1)}</b> (${(now - price) * qty > 0 ? "+" : ""}${won(Math.round((now - price) * qty))}원) · ${won(now)}원`;
    return `<div style="display:flex;align-items:center;gap:6px"><a class="row" href="#/s/${c}" style="flex:1;min-width:0"><div class="nm"><b>${esc(name)}</b>
      <small>${body}<br>산 가격 ${won(price)}원 × ${qty.toLocaleString("ko-KR")}주</small></div><div class="rt">${pill(s["p" + H])}</div></a>
      <button class="icon-btn" data-hdel="${c}" aria-label="빼기" style="padding:4px 8px">✕</button></div>`;
  }).join("");
  const gain = tn - tb;
  const holdHtml = `<div class="card"><h2>💼 내가 산 종목 <small>${hs.length}개 · AI ${H}일 뒤</small></h2>
    ${tb ? `<div class="split"><div class="stat"><small>지금 가치</small><b>${won(Math.round(tn))}원</b><div class="small muted">산 금액 ${won(Math.round(tb))}원</div></div>
      <div class="stat"><small>수익</small><b class="${cls(gain)}">${gain > 0 ? "+" : ""}${won(Math.round(gain))}원</b><div class="small ${cls(gain)}">${pctTxt(gain / tb * 100, 1)}</div></div></div>` : ""}
    ${hrows || `<div class="muted small">아직 넣은 종목이 없어요. 아래에서 추가해 보세요.</div>`}
    <details ${hs.length ? "" : "open"} style="margin-top:8px"><summary>➕ 종목 추가</summary>
      <div style="display:grid;gap:6px;margin-top:6px"><input id="hq" class="num" placeholder="종목 이름이나 코드 (예: 삼성전자)">
      <div class="split"><input id="hp" class="num" type="number" inputmode="decimal" placeholder="산 가격 (1주, 원)"><input id="hn" class="num" type="number" inputmode="decimal" placeholder="수량 (주)"></div>
      <button class="more" id="hadd">추가하기</button></div></details>
    <p class="muted small">🔺 수익 · 🔹 손실 · 수수료·세금은 빼지 않았어요. 같은 종목을 또 넣으면 평균 단가로 합쳐요.</p></div>`;

  // 🗳 AI vs 나 채점
  const vs = votes().slice(0, 20);
  const res = await Promise.all(vs.map(async (v) => {
    try {
      const d = await getJSON(`${DATA}s/${v[0]}.json`);
      const D = d.chart.d, C = d.chart.c, vd = yymmdd(v[3]);
      let pos = D.length - 1;
      while (pos > 0 && D[pos] > vd) pos--;
      // 찍은 날이 아직 차트에 없는 평일(오늘)이면 그날부터 셈
      const wd = new Date(v[3] + "T00:00:00").getDay();
      const end = pos + v[2] + (D[pos] < vd && wd !== 0 && wd !== 6 ? 1 : 0);
      if (end <= D.length - 1) {
        const done = D[end] < yymmdd(todayKST()) || marketState() !== "🟢 장 중";
        return [v, done, C[end] / v[4] - 1, 0];
      }
      const now = priceOf(BYCODE.get(v[0]) || { code: v[0], close: C[C.length - 1] }).now;
      return [v, false, now / v[4] - 1, end - (D.length - 1)];
    } catch { return null; }
  }));
  const ok = res.filter(Boolean), done = ok.filter((x) => x[1]);
  let voteHtml = `<p class="muted small">종목 분석 화면에서 '📈 오른다 / 📉 내린다'를 찍어 보세요. 기간이 지나면 나와 AI 중 누가 맞혔는지 여기서 채점해요.</p>`;
  if (ok.length) {
    const meHit = done.filter(([v, , r]) => (v[5] === "u") === (r > 0)).length;
    const aiHit = done.filter(([v, , r]) => (v[6] >= 50) === (r > 0)).length;
    voteHtml = (done.length ? `<div class="split"><div class="stat"><small>나의 적중률</small><b>${Math.round(meHit / done.length * 100)}%</b><div class="small muted">${done.length}번 중 ${meHit}번</div></div>
      <div class="stat"><small>AI 적중률</small><b>${Math.round(aiHit / done.length * 100)}%</b><div class="small muted">${meHit > aiHit ? "🏆 내가 이기고 있어요!" : aiHit > meHit ? "🤖 AI가 이기고 있어요" : "🤝 비기고 있어요"}</div></div></div>` : "")
      + `<table style="margin-top:6px"><tr><th>날짜</th><th>종목</th><th>나</th><th>AI</th><th class="r">결과</th></tr>${ok.map(([v, d2, r, left]) => {
        const me = v[5] === "u" ? "📈" : "📉", ai = v[6] >= 50 ? "📈" : "📉", real = r > 0 ? "📈" : "📉";
        const txt = d2 ? `${real} ${pctTxt(r * 100, 1)}<br>나 ${me === real ? "✅" : "❌"} AI ${ai === real ? "✅" : "❌"}`
          : `⏳ ${left ? `${left}거래일 남음` : "오늘 장 마감 후"}<br><small>(${pctTxt(r * 100, 1)})</small>`;
        return `<tr><td>${v[3].slice(5).replace("-", "/")}</td><td><a href="#/s/${v[0]}">${esc(v[1])}</a> <small class="muted">${v[2]}일</small></td><td>${me}</td><td>${ai}${v[6]}%</td><td class="r">${txt}</td></tr>`;
      }).join("")}</table><p class="muted small">찍은 날 가격과 기간(1·5·20거래일)이 지난 날 종가를 비교해요. 같은 종목·기간은 하루에 한 번만 찍을 수 있어요.</p>`;
  }

  after(() => {
    document.querySelectorAll("[data-del]").forEach((b) => b.onclick = (e) => { e.preventDefault(); toggleFav(b.dataset.del); render(); });
    document.querySelectorAll("[data-hdel]").forEach((b) => b.onclick = () => {
      store.set("ss-hold", holds().filter((x) => x[0] !== b.dataset.hdel)); toast("뺐어요"); render();
    });
    $("#hadd").onclick = () => {
      const s = searchList($("#hq").value, 1)[0], price = +$("#hp").value, qty = +$("#hn").value;
      if (!s) { toast("종목을 못 찾았어요"); return; }
      if (!(price > 0) || !(qty > 0)) { toast("산 가격과 수량을 넣어 주세요"); return; }
      const all = holds(), old = all.find((x) => x[0] === s.code);
      let p2 = price, q2 = qty;
      if (old) { q2 = old[3] + qty; p2 = (old[2] * old[3] + price * qty) / q2; }
      store.set("ss-hold", [[s.code, s.name, p2, q2], ...all.filter((x) => x[0] !== s.code)].slice(0, 30));
      toast(`✅ ${s.name}을(를) 추가했어요`); render();
    };
  });
  return `<div class="toolbar">${segH()}<span class="muted small">${esc(marketState())} ${esc(liveLabel())}</span></div>
  <div class="card"><h2>⭐ 관심 종목 <small>${favs().length}개</small></h2>${favList(0, true)}</div>
  ${holdHtml}
  <div class="card"><h2>🗳 AI vs 나</h2>${voteHtml}</div>
  <p class="muted small">관심 종목·산 종목·찍은 기록은 이 휴대폰(브라우저)에만 저장돼요. 서버로 보내지 않아요.</p>${foot()}`;
}, "my");

// ───────── 🔎 조건검색 ─────────
let scState = Object.assign({ prob: 60, hit: 100, mkt: "ALL", price: "all", safe: true }, store.get("ss-sc", {}));
let scShow = 30;
route(/^\/screen/, async () => {
  await Promise.all([loadIndex(), loadLive()]);
  const k = "p" + H, hk = "hr" + H;
  let d = INDEX.filter((s) => s[k] != null && !s.halted && s[k] >= scState.prob / 100);
  if (scState.hit < 100) d = d.filter((s) => { const t = hitTop(s[hk]); return t != null && t <= scState.hit; });
  if (scState.mkt !== "ALL") d = d.filter((s) => s.market === scState.mkt);
  const PR = { all: [0, Infinity], a: [0, 1e4], b: [1e4, 5e4], c: [5e4, 2e5], d: [2e5, Infinity] }[scState.price];
  d = d.filter((s) => { const p = priceOf(s).now; return p != null && p >= PR[0] && p < PR[1]; });
  if (scState.safe) d = d.filter((s) => !s.managed && !s.alert);
  d.sort((a, b) => b[k] - a[k]);
  const seg = (name, opts) => `<div class="seg" data-sc="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(scState[name]) ? "on" : ""}">${l}</button>`).join("")}</div>`;
  after(() => {
    const save = () => { store.set("ss-sc", scState); scShow = 30; render(); };
    document.querySelectorAll("[data-sc] button").forEach((b) => b.onclick = () => {
      const n = b.parentElement.dataset.sc; scState[n] = n === "hit" ? +b.dataset.v : b.dataset.v; save();
    });
    const rg = $("#scp");
    rg.oninput = () => { $("#scpv").textContent = rg.value + "%"; };
    rg.onchange = () => { scState.prob = +rg.value; save(); };
    $("#scprice").onchange = (e) => { scState.price = e.target.value; save(); };
    $("#scsafe").onchange = (e) => { scState.safe = e.target.checked; save(); };
    const m = $("#scmore"); if (m) m.onclick = () => { scShow += 30; render(); };
  });
  return `<div class="card"><h2>🔎 조건검색</h2><p class="muted small" style="margin-top:-6px">원하는 조건을 고르면 코스피·코스닥 전 종목에서 맞는 종목을 찾아 드려요.</p>
    <div style="display:grid;gap:10px">
    <div>${segH()}</div>
    <label class="small">📈 상승 확률 <b id="scpv">${scState.prob}%</b> 이상<input id="scp" type="range" min="50" max="80" step="1" value="${scState.prob}" style="width:100%"></label>
    <div class="small">🎯 적중률 순위<br>${seg("hit", [[100, "상관없음"], [50, "상위 50%"], [30, "상위 30%"], [10, "상위 10%"]])}</div>
    <div class="small">시장<br>${seg("mkt", [["ALL", "전체"], ["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]])}</div>
    <label class="small">주가 <select id="scprice" class="num">${[["all", "전체"], ["a", "1만 원 미만"], ["b", "1~5만 원"], ["c", "5~20만 원"], ["d", "20만 원 이상"]]
      .map(([v, l]) => `<option value="${v}" ${v === scState.price ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="ck"><input type="checkbox" id="scsafe" ${scState.safe ? "checked" : ""}> ⚠️ 관리종목·투자주의/경고/위험 종목 빼기</label></div></div>
  <div class="card"><h2>조건에 맞는 종목 <small>${d.length.toLocaleString("ko-KR")}개</small></h2>
    ${d.length ? d.slice(0, scShow).map((s, i) => stockRow(s, { rank: i + 1 })).join("") : `<div class="muted small">조건에 맞는 종목이 없어요. 상승 확률을 낮추거나 적중률 조건을 풀어 보세요.</div>`}
    ${d.length > scShow ? `<button class="more" id="scmore">30개 더 보기</button>` : ""}
    <p class="muted small">상승 확률이 높은 순서예요. AI 기준일 ${esc(META?.date || "-")} · 적중률 순위는 최근 60번 예측 기준. 조건에 맞는다고 오른다는 보장은 없어요.</p></div>${foot()}`;
}, "rank");

// ───────── 🌏 시장 분위기 ─────────
route(/^\/market/, async () => {
  await Promise.all([loadIndex(), loadLive()]);
  let mk = [];
  try { mk = await getJSON(DATA + "market.json", 3600000); } catch { /* 없음 */ }
  const idx = (LIVEJ && LIVEJ.idx) || {};
  const liveOf = { "코스피": idx.KOSPI, "코스닥": idx.KOSDAQ };
  const cards = mk.map((x) => {
    const l = liveOf[x.name];
    const v = l ? l[0] : x.last, c = l ? l[1] : x.chg * 100;
    return `<div class="stat"><small>${esc(x.name)}</small><b>${v.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${x.name.includes("환율") ? "원" : ""}</b>
      <div class="${cls(c)}">${c > 0 ? "▲" : c < 0 ? "▼" : ""}${pctTxt(c, 2)}</div></div>`;
  }).join("");
  const mood = HS.map((h) => {
    const all = INDEX.filter((s) => s["a" + h] != null && !s.halted);
    const share = (l) => (l.length ? l.filter((s) => s["a" + h] >= 0.5).length / l.length : null);
    const sh = share(all);
    if (sh == null) return "";
    const lab = sh >= 0.55 ? ["상승 우세", "up"] : sh <= 0.45 ? ["하락 우세", "down"] : ["팽팽", ""];
    const det = [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]].map(([m, ko]) => `${ko} ${Math.round(share(all.filter((s) => s.market === m)) * 100)}%`).join(" · ");
    return `<div class="stat"><small>${h}일 뒤 오를 것 같은 종목</small><b>${Math.round(sh * 100)}%</b><div class="small ${lab[1]}">${lab[0]}</div><div class="small muted">${det}</div></div>`;
  }).join("");
  const ks = mk.filter((x) => x.name === "코스피" || x.name === "코스닥");
  after(() => {
    if (ks.length) {
      const labels = ks[0].d;
      drawLines($("#mchart"), labels, ks.map((x, i) => {
        const m = new Map(x.d.map((dd, j) => [dd, x.c[j]]));
        const b = x.c[0];
        return { v: labels.map((dd) => (m.has(dd) ? (m.get(dd) / b - 1) * 100 : null)), color: i ? "#3b82f6" : "#e5484d" };
      }), { ref: 0, fmt: (v) => Math.round(v) + "%" });
    }
  });
  return `<div class="card"><h2>🌏 주요 지수 <small>${esc(marketState())}</small></h2>${cards ? `<div class="split">${cards}</div>` : `<div class="muted small">지금은 지수를 불러오지 못했어요.</div>`}
    <p class="muted small">전 거래일 대비 · 코스피·코스닥은 장중 20분마다 새로 고침 · 미국 지수·환율은 오후 5시 기준(미국 지수는 한국 시간 새벽에 마감).</p>
    ${ks.length ? `<p class="small" style="margin:10px 0 2px"><b>최근 3개월 등락률</b></p><canvas id="mchart"></canvas>${legend([["#e5484d", "코스피"], ["#3b82f6", "코스닥"]])}` : ""}</div>
  <div class="card"><h2>🤖 AI가 본 시장 분위기</h2><div class="split">${mood}</div>
    <p class="muted small">${esc(META?.date || "")} 장 마감 기준 · 전 종목 중 AI 상승 확률(차트 AI)이 50% 이상인 종목의 비율이에요. 55% 이상이면 '상승 우세', 45% 이하면 '하락 우세'.</p></div>${foot()}`;
}, "home");

// ───────── 🆚 비교 ─────────
route(/^\/cmp(?:\?(\d{6})?-(\d{6})?)?/, async (a, b) => {
  await Promise.all([loadIndex(), loadLive()]);
  const nameOf = (c) => (c && BYCODE.get(c) ? BYCODE.get(c).name : "");
  after(() => {
    $("#cmpgo").onclick = () => {
      const x = searchList($("#ca").value, 1)[0], y = searchList($("#cb").value, 1)[0];
      if (!x || !y) { toast("두 종목을 모두 찾을 수 있게 넣어 주세요"); return; }
      location.hash = `#/cmp?${x.code}-${y.code}`;
    };
  });
  const form = `<div class="card"><h2>🆚 두 종목 비교</h2><p class="muted small" style="margin-top:-6px">두 종목을 넣으면 AI 확률·적중률·기본 정보를 나란히 비교해요.</p>
    <div style="display:grid;gap:6px"><input id="ca" class="num" placeholder="첫 번째 종목 (예: 삼성전자)" value="${esc(nameOf(a))}">
    <input id="cb" class="num" placeholder="두 번째 종목 (예: SK하이닉스)" value="${esc(nameOf(b))}">
    <button class="more" id="cmpgo">비교하기</button><div>${segH()}</div></div></div>`;
  if (!a || !b) return form + foot();
  let A, B;
  try { [A, B] = await Promise.all([getJSON(`${DATA}s/${a}.json`), getJSON(`${DATA}s/${b}.json`)]); }
  catch { return form + `<div class="empty">두 종목 중 하나의 분석 자료가 없어요.</div>` + foot(); }
  const xs = [A, B].map((d) => {
    const s = BYCODE.get(d.code) || { code: d.code, close: d.close, chg: d.chg };
    const pr = priceOf(s), P = d.prob[H] || d.prob[String(H)], ST = d.stat[H] || d.stat[String(H)] || {};
    const hr = ST.n ? ST.hits / ST.n : null, FL = (d.follow || {})[H] || (d.follow || {})[String(H)];
    const ns = ((d.prob["1"] || {}).news || 0) / 0.06;
    const c = d.chart.c;
    return { d, pr, P, hr, top: hitTop(ST.n >= 60 ? hr : null), FL, ns, mood: d.news && d.news.length ? newsMood(ns) : "뉴스 없음",
      yr: c[c.length - 1] / c[0] - 1, gap: d.cons && d.cons.target ? d.cons.target / pr.now - 1 : null, info: d.info || {} };
  });
  const rows = [
    ["현재가", ...xs.map((x) => `${won(x.pr.now)}원<br><small class="${cls(x.pr.chg)}">${pctTxt(x.pr.chg)}</small>`), null, null],
    [`${H}일 뒤 오를 확률`, ...xs.map((x) => (x.P ? `${(x.P.p * 100).toFixed(1)}%` : "-")), ...xs.map((x) => (x.P ? x.P.p : null))],
    ["최근 적중률", ...xs.map((x) => (x.hr != null ? Math.round(x.hr * 100) + "%" : "-")), ...xs.map((x) => x.hr)],
    ["적중률 순위", ...xs.map((x) => (x.top ? `상위 ${x.top}%` : "-")), ...xs.map((x) => (x.top ? -x.top : null))],
    ["뉴스 분위기", ...xs.map((x) => x.mood), ...xs.map((x) => x.ns)],
    ["AI 따라 했다면(1년)", ...xs.map((x) => (x.FL ? pctTxt(x.FL.s * 100, 1) : "-")), ...xs.map((x) => (x.FL ? x.FL.s : null))],
    ["1년 주가 수익률", ...xs.map((x) => pctTxt(x.yr * 100, 1)), ...xs.map((x) => x.yr)],
    ["목표주가까지", ...xs.map((x) => (x.gap != null ? pctTxt(x.gap * 100, 1) : "-")), ...xs.map((x) => x.gap)],
    ...["시가총액", "PER", "PBR", "배당수익률"].map((k) => [k, ...xs.map((x) => esc(x.info[k] || "-")), null, null]),
  ];
  after(() => {
    const L = xs.map((x) => x.d.chart);
    const labels = L[0].d.length >= L[1].d.length ? L[0].d : L[1].d;
    drawLines($("#cchart"), labels, L.map((ch, i) => {
      const m = new Map(ch.d.map((dd, j) => [dd, ch.c[j]]));
      const base = ch.c[0];
      return { v: labels.map((dd) => (m.has(dd) ? (m.get(dd) / base - 1) * 100 : null)), color: i ? "#3b82f6" : "#e5484d" };
    }), { ref: 0, fmt: (v) => Math.round(v) + "%" });
  });
  return form + `<div class="card"><table class="cmp"><tr><th></th>${xs.map((x) => `<th><a href="#/s/${x.d.code}">${esc(x.d.name)} ›</a></th>`).join("")}</tr>
    ${rows.map(([lab, va, vb, na, nb]) => {
      let wa = "", wb = "";
      if (na != null && nb != null && na !== nb) [wa, wb] = na > nb ? ["win", "lose"] : ["lose", "win"];
      return `<tr><td>${lab}</td><td class="${wa}">${va}</td><td class="${wb}">${vb}</td></tr>`;
    }).join("")}</table>
    <p class="muted small">빨간 굵은 글씨 = 둘 중 더 나은 쪽, 파란 글씨 = 아닌 쪽. 확률은 뉴스·테마까지 반영한 값이고, 과거 성적이 앞으로를 보장하지 않아요.</p>
    <p class="small" style="margin:10px 0 2px"><b>최근 1년 주가 등락률</b></p><canvas id="cchart"></canvas>
    ${legend([["#e5484d", esc(A.name)], ["#3b82f6", esc(B.name)]])}</div>${foot()}`;
}, "home");

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
    $("#refresh").onclick = () => { memo.clear(); INDEX = null; for (const o of [hitPool, orderMemo]) for (const k in o) delete o[k]; toast("새로 불러왔어요"); location.hash = "#/"; render(); };
  });
  const link = (u, t) => `<a class="row" href="${u}"><div class="nm"><b>${t}</b></div><span class="muted">›</span></a>`;
  return `<div class="card"><h2>📂 전체 메뉴</h2>${catBar()}<p class="muted small">예전 앱의 8가지 화면을 모두 여기서 열 수 있어요. 아래 탭: 🏠 홈(분석) · 🏆 순위(확률·적중·조건검색) · 🧩 테마 · ⭐ 내 종목(관심·산 종목·AI vs 나).</p></div>
  <div class="card"><h2>⚙️ 설정</h2>
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

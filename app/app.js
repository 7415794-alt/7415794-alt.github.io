/* 스톡시그널 앱 v2.4.1
   - 매일 오후 5시에 계산해 둔 파일(AI 확률·차트·뉴스·테마)과 장중 20분마다 모은 현재가를 읽어서 바로 보여 줌.
   - 서버 계산이 없어서 빠르고, 한 번 본 자료는 인터넷이 끊겨도 다시 볼 수 있음. */
"use strict";
const VERSION = "2.16.0";
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
// 초성 검색 (ㅅㅅㅈㅈ → 삼성전자)과 자주 부르는 별명
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const chosung = (t) => [...t].map((c) => { const k = c.charCodeAt(0) - 0xac00; return k >= 0 && k < 11172 ? CHO[Math.floor(k / 588)] : ""; }).join("");
const ALIAS = { "000660": "하이닉스", "005380": "현대자동차현대차", "035420": "네이버", "005490": "포스코", "035720": "카카오", "373220": "엘지엔솔엘지에너지솔루션", "066570": "엘지전자" };
let INDEX = null, BYCODE = new Map(), META = null, LIVEJ = null;
async function loadIndex() {
  if (INDEX) return INDEX;
  const [ix, meta] = await Promise.all([getJSON(DATA + "index.json"), getJSON(DATA + "meta.json").catch(() => null)]);
  META = meta;
  const c = ix.cols;
  INDEX = ix.rows.map((r) => Object.fromEntries(c.map((k, i) => [k, r[i]])));
  INDEX.forEach((s) => {
    s.key = (s.name + s.code + (ALIAS[s.code] || "") + (s.alt || "")).toLowerCase().replace(/\s/g, "") + "|" + chosung(s.name) + "|" + chosung(s.alt || "");
    BYCODE.set(s.code, s);
  });
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
// 거래정지: 어제 계산 기준 + 장중에 새로 멈춘 종목 (모든 순위에서 뺌)
const halt = (s) => !!(s && (s.halted || priceOf(s).halted));
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
  pushSync();
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
    const al = (ALIAS[s.code] || "").toLowerCase().includes(k) || (s.alt || "").toLowerCase().replace(/\s/g, "").includes(k);
    const score = (s.name.toLowerCase().replace(/\s/g, "") === k || s.code.toLowerCase() === k ? 0 : al ? 0.6 : i === 0 ? 1 : 2) + (s.p5 == null ? 0.5 : 0);
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
// 메뉴: 묶음별 화면 목록 (더보기에서 묶어서, 홈에는 8칸만)
const MENU = [
  ["🤖 AI 예측", [["#/rank?up", "🏆", "확률순위"], ["#/rank?best", "🎯", "적중순위"], ["#/score", "📋", "AI 성적표"], ["#/aifollow", "🤖", "AI 따라하기"], ["#/cmp", "🆚", "비교"]]],
  ["💼 내 투자", [["#/my", "💼", "내 종목"], ["#/calc", "🧮", "계산기"], ["#/risk", "⚠️", "위험 종목"], ["#/ovh", "💣", "물량 경고"], ["#/paper", "🎮", "가상 계좌"], ["#/league", "🏆", "모의투자 랭킹"], ["#/week", "🗞️", "주간 리포트"]]],
  ["🗞 시장 소식", [["#/issues", "🔥", "오늘 이슈"], ["#/themes", "🧩", "테마"], ["#/market", "🌏", "시장 분위기"], ["#/cal", "📅", "일정 달력"],
    ["#/ins", "👔", "임원 매매"], ["#/div", "💰", "배당 순위"], ["#/brief", "☀️", "아침 브리핑"]]],
  ["🔎 찾기·공부", [["#/screen", "🔎", "조건검색"], ["#/hot", "🚀", "신고가·급증"], ["#/terms", "📖", "용어 사전"]]],
];
const CATS = MENU.flatMap((g) => g[1]);
const TABBED = new Set(["#/", "#/my", "#/rank?up", "#/themes"]); // 아래 탭에 이미 있는 화면은 홈 8칸에서 뺌
const HOME_DEF = ["#/issues", "#/cal", "#/score", "#/risk", "#/calc", "#/screen", "#/terms"];
const HOME_N = 7;
const tile = ([u, e, l], extra = "") => `<a href="${u}" data-m="${u}"${extra}><b>${e}</b>${l}</a>`;
// 홈 메뉴: 직접 고른 것(📌) → 많이 누른 순 → 기본 순서
function homeMenu() {
  const by = new Map(CATS.map((c) => [c[0], c]));
  const pin = store.get("ss-pin", null);
  if (Array.isArray(pin) && pin.length) return pin.map((u) => by.get(u)).filter(Boolean).slice(0, HOME_N);
  const n = store.get("ss-clicks", {});
  return CATS.filter((c) => !TABBED.has(c[0]))
    .map((c, i) => [c, (n[c[0]] || 0) * 20 + (HOME_DEF.includes(c[0]) ? 50 - HOME_DEF.indexOf(c[0]) : -i)])
    .sort((a, b) => b[1] - a[1]).slice(0, HOME_N).map((x) => x[0]);
}
const catBar = () => { menuEdit = false; document.body.classList.remove("menu-edit"); return catBarHtml(); };
const catBarHtml = () => `<div class="cats">${homeMenu().map((c) => tile(c)).join("")}${tile(["#/more", "📂", "전체"])}</div>`;
// 메뉴를 누를 때마다 이 휴대폰에만 횟수를 셈 (홈 자동 정렬용)
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[data-m]");
  if (!a || a.dataset.m === "#/more" || document.body.classList.contains("menu-edit")) return;
  const n = store.get("ss-clicks", {});
  n[a.dataset.m] = Math.min((n[a.dataset.m] || 0) + 1, 9999);
  store.set("ss-clicks", n);
});
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
    const l = INDEX.filter((s) => s[key] != null && !halt(s)).sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key]));
    orderMemo[id] = new Map(l.map((s, i) => [s.code, i + 1]));
  }
  return orderMemo[id];
}
function moveTxt(code, kind) {
  if (!META || !META.prev_date) return "";
  const desc = kind !== "down";
  const now = orderMap("a" + H, desc).get(code), old = orderMap("q" + H, desc).get(code);
  if (now == null) return "";
  if (old == null || (old > 100 && now <= 100)) return `<span class="mv new">🆕</span>`;
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
    return `<a class="card" href="#/score" style="display:block"><h2>📋 어제 AI 성적표 <small>${md(r.date)} 예측 → ${md(r.eval_date)} 결과 · 자세히 ›</small></h2>
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
// 🎯 목표가 알림 {코드: [이 가격 이상, 이 가격 이하]}
const tgts = () => store.get("ss-tgt", {});
function tgtHit(c, now) {
  const t = tgts()[c];
  if (!t || now == null) return null;
  if (t[0] && now >= t[0]) return ["u", t[0]];
  if (t[1] && now <= t[1]) return ["d", t[1]];
  return null;
}

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
    과거 10년 시험 적중률 코스피 ${a("KOSPI")}·코스닥 ${a("KOSDAQ")} (늘 '오른다'고 하면 ${b("KOSPI")}·${b("KOSDAQ")})${done.length ? ` · 실제 기록 ${done.length}번 중 ${hits}번 맞힘` : ""}.
    ⚠️ 맞히는 힘은 대부분 '아침에 높게 시작할지'에서 나와요. 장이 열린 뒤 방향은 맞히지 못했어요. (자세한 시험 기록: 더보기 → 연구 기록 ⑥)</p>`;
}

// ───────── ☀️ 아침 브리핑 ─────────
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const dayTxt = (iso) => { const d = new Date(iso + "T00:00:00+09:00"); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };
// 그날이 옵션 만기일(매달 둘째 목요일)인지, 3·6·9·12월이면 동시 만기
function expiryOf(iso) {
  const d = new Date(iso + "T00:00:00+09:00");
  const first = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  const second = 1 + ((4 - first + 7) % 7) + 7;
  return d.getDate() === second ? ([2, 5, 8, 11].includes(d.getMonth()) ? "quad" : "opt") : "";
}
function usLine(us) {
  const g = (n) => us.find((x) => x.n === n);
  const big = ["S&P 500", "나스닥", "다우"].map(g).filter(Boolean);
  const ups = big.filter((x) => x.c > 0).length;
  const parts = [];
  if (big.length) parts.push(ups === big.length ? "미국 3대 지수가 모두 올랐어요" : ups === 0 ? "미국 3대 지수가 모두 내렸어요" : "미국 지수가 엇갈렸어요");
  const sox = g("필라델피아 반도체");
  if (sox && Math.abs(sox.c) >= 1.5) parts.push(`반도체 지수가 ${pctTxt(sox.c, 1)} 크게 ${sox.c > 0 ? "올라 반도체주에 관심이 쏠릴 수 있어요" : "내려 반도체주가 약할 수 있어요"}`);
  const vix = g("공포지수(VIX)");
  if (vix && vix.v >= 25) parts.push(`공포지수가 ${vix.v.toFixed(1)}로 불안한 분위기예요`);
  const fx = g("원/달러 환율");
  if (fx && Math.abs(fx.c) >= 0.5) parts.push(`환율이 ${pctTxt(fx.c, 1)} 움직였어요`);
  const nq = g("나스닥 선물");
  if (nq && Math.abs(nq.c) >= 0.3) parts.push(`지금 나스닥 선물은 ${pctTxt(nq.c, 1)}로 ${nq.c > 0 ? "오르는" : "내리는"} 중이에요`);
  return parts.join(". ") + (parts.length ? "." : "");
}
route(/^\/brief/, async () => {
  const [, , ij] = await Promise.all([loadIndex(), loadLive(), getJSON(IDXP, 600000).catch(() => null)]);
  const today = kstToday();
  const day = ij && ij.KOSPI && ij.KOSPI.for >= today ? ij.KOSPI.for : today;
  const us = [...((ij && ij.us) || [])];
  // 장 시작 전 미국 지수 선물: 20분마다 받는 값(live.json)이 오늘 것이면 그걸로 바꿔 씀
  const LI = (LIVEJ && LIVEJ.idx) || {};
  [["NQF", "나스닥 선물"], ["ESF", "S&P 500 선물"]].forEach(([k, n]) => {
    const l = LI[k];
    if (!l || !l[3] || l[3].slice(0, 10) !== today) return;
    const i = us.findIndex((x) => x.n === n), v = { n, v: l[0], c: l[1], t: l[3].slice(11) };
    if (i >= 0) us[i] = v; else us.push(v);
  });
  const usHtml = us.length ? `<div class="split">${us.map((x) => `<div class="stat"><small>${esc(x.n)}${x.t ? ` <span class="muted">${x.t}</span>` : ""}</small>
      <b>${x.v.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${x.n.includes("환율") ? "원" : x.n.includes("금리") ? "%" : ""}</b>
      <div class="${x.n.includes("VIX") || x.n.includes("환율") ? "" : cls(x.c)}">${x.c > 0 ? "▲" : x.c < 0 ? "▼" : ""}${pctTxt(x.c, 2)}</div></div>`).join("")}</div>
      <p class="small" style="margin:8px 0 0">${esc(usLine(us))}</p>` : `<div class="muted small">미국 증시 요약은 평일 아침 7시쯤 나와요.</div>`;
  const idxCards = ["KOSPI", "KOSDAQ"].map((k) => `<div class="stat"><small>${k === "KOSPI" ? "코스피" : "코스닥"}</small>
      <b>${ij && ij[k] ? won(ij[k].close) : "-"}</b><div class="small muted">${ij && ij[k] ? mdOf(ij[k].base) + " 종가" : ""}</div>${idxProb(ij, k)}</div>`).join("");
  let th = [];
  try { th = await getJSON(DATA + "themes.json", 3600000); } catch { /* 없음 */ }
  const ths = th.filter((t) => t.chg != null).sort((a, b) => b.chg - a.chg);
  const thRow = (t) => `<a class="row" href="#/t/${t.no}"><div class="nm"><b>${esc(t.name)}</b></div><div class="rt"><b class="${cls(t.chg)}">${pctTxt(t.chg, 1)}</b></div></a>`;
  const oldH = H; H = 1;
  const top = INDEX.filter((s) => s.p1 != null && !s.managed && !s.alert && !halt(s)).sort((a, b) => b.p1 - a.p1).slice(0, 5);
  const topHtml = top.map((s, i) => stockRow(s, { rank: i + 1 })).join("");
  const favHtml = favs().length ? favList(5) : "";
  H = oldH;
  const ex = expiryOf(day);
  const sched = [];
  if (ex) sched.push(ex === "quad" ? "📌 오늘은 <b>선물·옵션 동시 만기일</b>이에요. 장 마감 무렵 큰 물량이 오가며 가격이 출렁일 수 있어요." : "📌 오늘은 <b>옵션 만기일</b>이에요. 장 마감 무렵 지수가 출렁일 수 있어요.");
  const d0 = new Date(day + "T00:00:00+09:00");
  for (let i = 1; i <= 6; i++) {
    const dd = new Date(d0.getTime() + i * 864e5), iso = new Date(dd.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
    if (dd.getDay() === 0 || dd.getDay() === 6) continue;
    const e = expiryOf(iso);
    if (e) { sched.push(`🗓️ ${dayTxt(iso)}은 ${e === "quad" ? "선물·옵션 동시 만기일" : "옵션 만기일"}이에요.`); break; }
  }
  if (d0.getDate() >= 24) sched.push("🗓️ 월말이 가까워요. 펀드 결산·리밸런싱으로 대형주 거래가 늘 수 있어요.");
  const sc = await scorecardHtml(true);
  return `
  <div class="card"><h2>☀️ ${dayTxt(day)} 아침 브리핑</h2>
    <p class="small muted" style="margin:0">장 시작 전에 알아 두면 좋은 것만 모았어요. ${ij && ij.t ? `${mdOf(ij.t.slice(0, 10))} ${esc(ij.t.slice(11))} 계산` : ""}</p></div>
  <div class="card"><h2>🌎 어젯밤 미국 증시</h2>${usHtml}</div>
  <div class="card"><h2>🤖 오늘 코스피·코스닥</h2><div class="mkt">${idxCards}</div>${idxNote(ij)}</div>
  ${sched.length ? `<div class="card"><h2>📅 오늘의 일정 <a class="small muted" href="#/cal">달력 ›</a></h2>${sched.map((x) => `<p class="small" style="margin:4px 0">${x}</p>`).join("")}</div>` : ""}
  ${sc}
  ${ths.length ? `<div class="card"><h2>🧩 어제 테마 흐름 <a class="small muted" href="#/themes">전체 ›</a></h2>
    <p class="small" style="margin:4px 0"><b>강했던 테마</b></p>${ths.slice(0, 3).map(thRow).join("")}
    <p class="small" style="margin:10px 0 4px"><b>약했던 테마</b></p>${ths.slice(-3).reverse().map(thRow).join("")}</div>` : ""}
  ${favHtml ? `<div class="card"><h2>⭐ 내 관심 종목 <small>1일 뒤 확률</small> <a class="small muted" href="#/my">전체 ›</a></h2>${favHtml}</div>` : ""}
  <div class="card"><h2>🔥 AI가 본 오늘 상승 확률 TOP 5 <a class="small muted" href="#/rank?up">더 보기 ›</a></h2>${topHtml}
    <p class="muted small">어제 장 마감까지의 자료로 계산한 '1거래일 뒤' 확률이에요. 추천이 아니라 참고 정보예요.</p></div>
  ${foot()}`;
}, "home");

// 막대 그래프 (날짜별 적중률 등): bars = [{v, color}], dots = 비교용 가로 표시
function drawBars(cv, labels, bars, opt = {}) {
  if (!cv || !labels.length) return;
  const css = getComputedStyle(document.documentElement);
  const col = (v) => (v.startsWith("--") ? css.getPropertyValue(v).trim() : v);
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = opt.h || 180;
  cv.width = W * dpr; cv.height = Hh * dpr; cv.style.height = Hh + "px";
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const pad = { l: 4, r: 40, t: 8, b: 18 }, ph = Hh - pad.t - pad.b;
  const [lo, hi] = opt.range || [0, 100];
  const step = (W - pad.l - pad.r) / labels.length, bw = Math.max(2, Math.min(18, step * 0.7));
  const x = (i) => pad.l + step * (i + 0.5);
  const y = (v) => pad.t + ph * (1 - (v - lo) / (hi - lo));
  g.font = "11px sans-serif"; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4, yy = y(v);
    g.strokeStyle = col("--line"); g.beginPath(); g.moveTo(pad.l, yy); g.lineTo(W - pad.r, yy); g.stroke();
    g.fillStyle = col("--muted"); g.fillText(opt.fmt ? opt.fmt(v) : Math.round(v), W - pad.r + 4, yy + 4);
  }
  bars.forEach((b, i) => {
    if (b.v == null) return;
    g.fillStyle = col(b.color);
    const top = y(Math.max(lo, Math.min(hi, b.v))), base = y(lo);
    g.fillRect(x(i) - bw / 2, top, bw, Math.max(1, base - top));
  });
  if (opt.dots) {
    g.fillStyle = col("--fg");
    opt.dots.forEach((v, i) => { if (v == null) return; g.fillRect(x(i) - bw / 2 - 1, y(v) - 1, bw + 2, 2.5); });
  }
  g.fillStyle = col("--muted");
  g.fillText(ymd(labels[0]), pad.l, Hh - 4);
  const last = ymd(labels[labels.length - 1]);
  g.fillText(last, W - pad.r - g.measureText(last).width, Hh - 4);
}

// ───────── 📋 AI 성적표 자세히 ─────────
route(/^\/score/, async () => {
  const [, card, ij] = await Promise.all([loadIndex(), getJSON(DATA + "scorecard.json", 3600000).catch(() => []), getJSON(IDXP, 600000).catch(() => null)]);
  if (!card || !card.length) return `<div class="empty">아직 채점 기록이 없어요.</div>${foot()}`;
  const pc = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const md = mdOf;
  const r = card[card.length - 1];
  // 기간별 요약
  const per = (n) => {
    const l = card.slice(-n), s = (k) => l.reduce((a, x) => a + (x[k] || 0), 0);
    const wins = l.filter((x) => x.up_hit / x.up_n > x.all_up).length;
    return { n: l.length, up: pc(s("up_hit"), s("up_n")), down: pc(s("down_hit"), s("down_n")), mk: Math.round(s("all_up") / l.length * 100), wins };
  };
  const ps = [5, 20, 60].filter((n, i, a) => i === 0 || card.length > a[i - 1]).map(per);
  const sumTable = `<table><tr><th>기간</th><th class="r">상승<br>TOP20</th><th class="r">하락<br>TOP20</th><th class="r">전체<br>상승</th><th class="r">시장보다<br>잘한 날</th></tr>
    ${ps.map((p) => `<tr><td style="white-space:nowrap">${p.n}일</td><td class="r"><b>${p.up}%</b></td><td class="r">${p.down}%</td><td class="r">${p.mk}%</td><td class="r">${p.wins}/${p.n}</td></tr>`).join("")}</table>`;
  const labels = card.map((x) => yymmdd(x.date));
  // AI 따라 샀다면: 매일 상승 TOP 20을 똑같이 나눠 사서 다음 날 판 경우 (수수료·세금 빼기 전)
  let a = 100, m = 100;
  const curA = card.map((x) => (a *= 1 + (x.up_avg || 0))), curM = card.map((x) => (m *= 1 + (x.all_avg || 0)));
  // 어제 TOP 20 종목별 결과
  let picks = "";
  if (META && META.prev_date === r.date) {
    const pool = INDEX.filter((s) => s.q1 != null && s.chg != null && !halt(s));
    const row = (s, i, want) => {
      const ok = want > 0 ? s.chg > 0 : s.chg < 0;
      return `<a class="row" href="#/s/${s.code}"><div class="nm"><b>${i + 1}. ${esc(s.name)}</b><small>어제 AI 확률 ${Math.round(s.q1 * 100)}%</small></div>
        <div class="rt"><b class="${cls(s.chg)}">${pctTxt(s.chg * 100, 1)}</b><small>${ok ? "✅ 맞음" : "❌ 틀림"}</small></div></a>`;
    };
    const up = [...pool].sort((x, y) => y.q1 - x.q1).slice(0, 20), dn = [...pool].sort((x, y) => x.q1 - y.q1).slice(0, 20);
    picks = `<div class="card"><h2>🔍 어제 고른 종목, 오늘 결과 <small>${md(r.date)} → ${md(r.eval_date)}</small></h2>
      <div class="seg" data-pk style="margin-bottom:6px"><button data-v="up" class="on">📈 상승 TOP 20</button><button data-v="dn">📉 하락 TOP 20</button></div>
      <div id="pk-up">${up.map((s, i) => row(s, i, 1)).join("")}</div><div id="pk-dn" hidden>${dn.map((s, i) => row(s, i, -1)).join("")}</div>
      <p class="muted small">'1거래일 뒤' 확률 기준. 상승 TOP 20은 오르면, 하락 TOP 20은 내리면 맞은 거예요.</p></div>`;
  }
  // 코스피·코스닥 예측 기록
  const ih = ((ij && ij.hist) || []).filter((h) => h.r != null && h.r !== 0).slice(-40).reverse();
  const ihit = ih.filter((h) => (h.p >= 0.5) === (h.r > 0)).length;
  const idxHtml = ih.length ? `<div class="card"><h2>🤖 코스피·코스닥 예측 기록 <small>${ih.length}번 중 ${ihit}번 맞힘</small></h2>
    <table><tr><th>날짜</th><th>지수</th><th class="r">AI 확률</th><th class="r">실제</th><th class="r">결과</th></tr>
    ${ih.slice(0, 20).map((h) => `<tr><td>${md(h.for)}</td><td>${h.k === "KOSPI" ? "코스피" : "코스닥"}</td><td class="r">${Math.round(h.p * 100)}%</td>
      <td class="r ${cls(h.r)}">${pctTxt(h.r * 100, 1)}</td><td class="r">${(h.p >= 0.5) === (h.r > 0) ? "✅" : "❌"}</td></tr>`).join("")}</table></div>` : "";
  // 종목별 적중률 평균 (최근 60번 예측 기준)
  const dist = [1, 5, 20].map((h) => {
    const v = INDEX.map((s) => s["hr" + h]).filter((x) => x != null);
    if (!v.length) return "";
    const avg = v.reduce((p, q) => p + q, 0) / v.length, over = v.filter((x) => x >= 0.6).length;
    return `<div class="stat"><small>${h}일 뒤 예측</small><b>${Math.round(avg * 100)}%</b><div class="small muted">60% 이상 맞힌 종목 ${won(over)}개 (${Math.round(over / v.length * 100)}%)</div></div>`;
  }).join("");

  after(() => {
    drawBars($("#sc-bar"), labels, card.map((x) => ({ v: pc(x.up_hit, x.up_n), color: x.up_hit / x.up_n > x.all_up ? "--up" : "--down" })),
      { dots: card.map((x) => x.all_up * 100), fmt: (v) => v + "%" });
    drawLines($("#sc-line"), labels, [{ v: curA, color: "--up" }, { v: curM, color: "--muted", w: 1.5 }], { ref: 100, fmt: (v) => v.toFixed(0) });
    const seg = document.querySelector("[data-pk]");
    if (seg) seg.onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      $("#pk-up").hidden = b.dataset.v !== "up"; $("#pk-dn").hidden = b.dataset.v === "up";
    };
  });
  return `
  <div class="card"><h2>📋 AI 성적표 자세히</h2>
    <p class="small muted" style="margin:0">매일 AI가 고른 '1거래일 뒤' 상승·하락 TOP 20이 실제로 맞았는지 채점한 기록이에요. 좋은 날만 골라 보여 주지 않고 모두 공개해요.</p></div>
  ${await scorecardHtml(true)}
  <div class="card"><h2>📊 기간별 적중률</h2>${sumTable}
    <p class="muted small">'전체 상승' = 그 기간 하루 평균 몇 % 종목이 올랐는지. 상승 TOP 20 적중률이 이것보다 높아야 AI가 의미 있게 고른 거예요.</p></div>
  <div class="card"><h2>📅 날짜별 상승 TOP 20 적중률</h2><canvas id="sc-bar"></canvas>
    <p class="muted small"><span class="up">■</span> 시장보다 잘한 날 · <span class="down">■</span> 시장보다 못한 날 · <b>▬</b> 그날 전체 종목 중 오른 비율</p></div>
  <div class="card"><h2>💰 AI를 따라 샀다면? <small>최근 ${card.length}일</small></h2><canvas id="sc-line"></canvas>
    ${legend([["var(--up)", `상승 TOP 20 매일 사고팔기 ${pctTxt(curA[curA.length - 1] - 100, 1)}`], ["var(--muted)", `전 종목 평균 ${pctTxt(curM[curM.length - 1] - 100, 1)}`]])}
    <p class="muted small">100에서 시작해 매일 상승 TOP 20을 똑같이 나눠 사고 다음 날 종가에 판 경우예요. 수수료·세금은 빼지 않았고, 실제로는 이만큼 벌기 어려워요.</p></div>
  ${picks}
  <div class="card"><h2>🎯 종목별 적중률 평균</h2><div class="split">${dist}</div>
    <p class="muted small">각 종목의 최근 60번 예측 중 맞힌 비율을 전 종목 평균한 값이에요. 종목 화면에서 그 종목만의 적중률을 볼 수 있어요.</p></div>
  ${idxHtml}
  <div class="card"><h2>🗂️ 날짜별 전체 기록</h2><table><tr><th>예측일</th><th class="r">상승<br>TOP20</th><th class="r">평균</th><th class="r">하락<br>TOP20</th><th class="r">전체<br>상승</th></tr>
    ${[...card].reverse().map((x) => `<tr><td>${md(x.date)}</td><td class="r">${x.up_hit}/${x.up_n}</td><td class="r ${cls(x.up_avg)}">${pctTxt(x.up_avg * 100, 1)}</td>
      <td class="r">${x.down_hit}/${x.down_n}</td><td class="r">${Math.round(x.all_up * 100)}%</td></tr>`).join("")}</table></div>
  ${foot()}`;
}, "rank");

// ───────── 📅 일정 달력 ─────────
// 휴장일 (한국거래소 기준, 바뀔 수 있음)
const HOLI = {
  "2026-01-01": "신정", "2026-02-16": "설 연휴", "2026-02-17": "설날", "2026-02-18": "설 연휴", "2026-03-02": "삼일절 대체 휴일",
  "2026-05-01": "근로자의 날", "2026-05-05": "어린이날", "2026-05-25": "부처님오신날 대체 휴일", "2026-06-03": "지방선거",
  "2026-08-17": "광복절 대체 휴일", "2026-09-24": "추석 연휴", "2026-09-25": "추석", "2026-10-05": "개천절 대체 휴일",
  "2026-10-09": "한글날", "2026-12-25": "성탄절", "2026-12-31": "연말 휴장",
  "2027-01-01": "신정", "2027-02-08": "설 연휴", "2027-02-09": "설 대체 휴일", "2027-03-01": "삼일절", "2027-05-05": "어린이날",
  "2027-05-13": "부처님오신날", "2027-08-16": "광복절 대체 휴일", "2027-09-14": "추석 연휴", "2027-09-15": "추석", "2027-09-16": "추석 연휴",
  "2027-10-04": "개천절 대체 휴일", "2027-10-11": "한글날 대체 휴일", "2027-12-27": "성탄절 대체 휴일", "2027-12-31": "연말 휴장",
};
// 미국 FOMC 금리 결정 (한국 시간으로 다음 날 새벽 발표)
const FOMC = ["2026-01-29", "2026-03-19", "2026-04-30", "2026-06-18", "2026-07-30", "2026-09-17", "2026-10-29", "2026-12-10"];
const isoOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const isOpen = (y, m, d) => { const w = new Date(y, m, d).getDay(); return w !== 0 && w !== 6 && !HOLI[isoOf(y, m, d)]; };
function monthEvents(y, m) {
  const ev = {};
  const add = (d, t, k) => { const key = isoOf(y, m, d); (ev[key] = ev[key] || []).push({ t, k }); };
  const last = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= last; d++) if (HOLI[isoOf(y, m, d)]) add(d, `휴장 (${HOLI[isoOf(y, m, d)]})`, "off");
  // 옵션 만기: 둘째 목요일, 쉬는 날이면 그 전 거래일
  const quad = [2, 5, 8, 11].includes(m);
  let ex = 1 + ((4 - new Date(y, m, 1).getDay() + 7) % 7) + 7;
  while (ex > 1 && !isOpen(y, m, ex)) ex--;
  add(ex, quad ? "선물·옵션 동시 만기일" : "옵션 만기일", quad ? "big" : "mid");
  // 그달 마지막 거래일
  let ld = last;
  while (ld > 1 && !isOpen(y, m, ld)) ld--;
  if (m === 11) add(ld, "올해 마지막 거래일 · 12월 결산 배당 기준일(많은 회사)", "big");
  else if ([2, 5, 8].includes(m)) add(ld, "분기 마지막 거래일 · 분기 배당 기준일(일부 회사)", "mid");
  else add(ld, "월말 마지막 거래일", "low");
  // 실적 관련 (법정 마감일·대략적인 시기)
  if ([0, 3, 6, 9].includes(m)) { let d = 7; while (!isOpen(y, m, d)) d++; add(d, "실적 시즌 시작 무렵 (삼성전자 등 잠정 실적, 대략)", "mid"); }
  // 보고서 마감일이 쉬는 날이면 다음 평일로
  const due = (d, t) => { while (d < last && !isOpen(y, m, d)) d++; add(d, t, "mid"); };
  if (m === 2) due(31, "사업보고서(1년 실적) 제출 마감");
  if (m === 4) due(15, "1분기 보고서 제출 마감");
  if (m === 7) due(14, "반기 보고서 제출 마감");
  if (m === 10) due(14, "3분기 보고서 제출 마감");
  // 미국
  const ym = isoOf(y, m, 1).slice(0, 8);
  FOMC.filter((x) => x.startsWith(ym)).forEach((x) => add(+x.slice(8), "미국 금리 결정(FOMC) 발표 (새벽)", "big"));
  let fr = 1;
  while (new Date(y, m, fr).getDay() !== 5) fr++;
  add(fr, "미국 고용 지표 발표 (밤 9시 반 무렵, 대략)", "low");
  return ev;
}
let calYM = null;
route(/^\/cal(?!c)/, async () => {
  const t = kstToday();
  if (!calYM) calYM = [+t.slice(0, 4), +t.slice(5, 7) - 1];
  const [y, m] = calYM;
  const ev = monthEvents(y, m);
  // 종목별 실적 발표: ⭐ 내 종목은 따로, 나머지는 날짜별로 묶어서
  const ER = await erMap(), mine = new Set([...favs(), ...holds().map((h) => h[0])]);
  if (ER) {
    const ym = isoOf(y, m, 1).slice(0, 8), byDay = {};
    Object.entries(ER).forEach(([c, v]) => {
      if (!v[0].startsWith(ym)) return;
      if (mine.has(c)) (ev[v[0]] = ev[v[0]] || []).push({ t: `⭐ ${v[3] || c} 실적 발표${v[1] === "예상" ? " (예상)" : ""}`, k: "er", c });
      else (byDay[v[0]] = byDay[v[0]] || []).push([c, v]);
    });
    Object.entries(byDay).forEach(([day, arr]) => {
      const fx = arr.filter((a) => a[1][1] === "확정").length;
      arr.sort((a, b) => (a[1][1] === "확정" ? 0 : 1) - (b[1][1] === "확정" ? 0 : 1));
      (ev[day] = ev[day] || []).push({ t: `실적 발표 ${arr.length}곳${fx ? ` (확정 ${fx})` : " (예상)"}`, k: "low",
        h: ` <details style="display:inline"><summary style="display:inline;cursor:pointer;color:var(--accent)">보기</summary><span style="display:block;line-height:1.9">${arr.slice(0, 120).map(([c, v]) =>
          `<a href="#/s/${c}">${v[1] === "확정" ? "<b>" + esc(v[3]) + "</b>" : esc(v[3])}</a>`).join(" · ")}${arr.length > 120 ? " …" : ""}</span></details>` });
    });
  }
  // 공모주·유상증자 청약 (전자공시 증권신고서)
  let OF = [];
  try { OF = (await DART("offer.json")).rows || []; } catch { /* 없음 */ }
  const ymo = isoOf(y, m, 1).slice(0, 8);
  const ofTxt = (r) => `${r[0] === "증자" ? "💵" : r[0] === "스팩" ? "📦" : "🆕"} ${r[1]} ${r[0] === "증자" ? "유상증자" : r[0] === "스팩" ? "스팩 공모" : "공모주"} 청약`;
  OF.forEach((r) => {
    if (r[3].startsWith(ymo)) (ev[r[3]] = ev[r[3]] || []).push({ t: `${ofTxt(r)} 시작 (~${r[4].slice(5).replace("-", "/")}${r[6] && r[6] !== "-" ? `, ${r[6]}원` : ""})`, k: "ipo", c: r[2] || null });
    if (r[4] !== r[3] && r[4].startsWith(ymo)) (ev[r[4]] = ev[r[4]] || []).push({ t: `${ofTxt(r)} 마감`, k: "ipo", c: r[2] || null });
  });
  const upOf = OF.filter((r) => r[4] >= t).slice(0, 30);
  const ofHtml = upOf.length ? `<div class="card"><h2>🆕 다가오는 공모주·증자 청약</h2><table><tr><th>청약일</th><th>회사</th><th class="r">가격</th></tr>
    ${upOf.map((r) => `<tr><td>${r[3].slice(5).replace("-", "/")}~${r[4].slice(8)}${r[3] <= t ? " <b class=\"up\">진행 중</b>" : ""}</td>
      <td>${r[2] ? `<a href="#/s/${r[2]}">${esc(r[1])}</a>` : esc(r[1])} <small class="muted">${esc(r[0] === "증자" ? "유상증자" : r[0])}</small><br><small class="muted">${esc(r[8] || "")}${r[5] ? ` · 납입 ${r[5].slice(5).replace("-", "/")}` : ""}${r[0] === "증자" && r[7] ? ` · ${esc(r[7])}` : ""}</small></td>
      <td class="r">${r[6] && r[6] !== "-" ? esc(r[6]) + "원" : "미정"}</td></tr>`).join("")}</table>
    <p class="muted small">전자공시 증권신고서에 적힌 일정이에요(매일 오후 5시 갱신). 공모가는 확정 전이면 희망 가격 기준이라 바뀔 수 있어요. 청약은 위에 적힌 증권사 계좌로 해요. 공모주는 상장 첫날 크게 오르기도 하지만 공모가 아래로 떨어지는 경우도 많아요.</p></div>` : "";
  const first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
  const dot = { big: "#e5484d", mid: "#f59e0b", low: "var(--muted)", off: "#3b82f6", er: "#8b5cf6", ipo: "#10b981" };
  let cells = "";
  for (let i = 0; i < first; i++) cells += `<div></div>`;
  for (let d = 1; d <= last; d++) {
    const k = isoOf(y, m, d), e = ev[k] || [], w = (first + d - 1) % 7;
    const off = w === 0 || w === 6 || HOLI[k];
    cells += `<button class="cal-d${k === t ? " today" : ""}${off ? " off" : ""}" data-day="${k}"><span>${d}</span>
      <i>${e.slice(0, 3).map((x) => `<b style="background:${dot[x.k]}"></b>`).join("")}</i></button>`;
  }
  // 그달 일정 전부 (지난 날은 흐리게)
  const list = Object.keys(ev).sort().map((k) =>
    `<div class="row" id="ev-${k}"${k < t ? ' style="opacity:.55"' : ""}><div class="nm"><b>${dayTxt(k)}${k === t ? " · 오늘" : k < t ? " · 지남" : ""}</b>${ev[k].map((x) => `<small style="display:block"><span style="color:${dot[x.k]}">●</span> ${x.c ? `<a href="#/s/${x.c}">${esc(x.t)}</a>` : esc(x.t)}${x.h || ""}</small>`).join("")}</div></div>`).join("");
  after(() => {
    document.querySelectorAll("[data-mv]").forEach((b) => b.onclick = () => {
      let [yy, mm] = calYM;
      mm += +b.dataset.mv;
      if (mm < 0) { mm = 11; yy--; }
      if (mm > 11) { mm = 0; yy++; }
      calYM = [yy, mm]; render();
    });
    document.querySelectorAll("[data-day]").forEach((b) => b.onclick = () => {
      const el = document.getElementById("ev-" + b.dataset.day);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200); }
      else toast(`${dayTxt(b.dataset.day)}: ${HOLI[b.dataset.day] ? "휴장" : "특별한 일정 없음"}`);
    });
  });
  return `
  <div class="card"><h2 style="display:flex;align-items:center;justify-content:space-between">
    <button class="icon-btn" data-mv="-1">‹</button><span>📅 ${y}년 ${m + 1}월 증시 일정</span><button class="icon-btn" data-mv="1">›</button></h2>
    <div class="cal-w">${WD.map((w) => `<span>${w}</span>`).join("")}</div><div class="cal-g">${cells}</div>
    <p class="muted small" style="margin:8px 0 0"><span style="color:${dot.big}">●</span> 중요 · <span style="color:${dot.mid}">●</span> 알아 두기 · <span style="color:${dot.off}">●</span> 휴장 · <span style="color:${dot.er}">●</span> 내 종목 실적 · <span style="color:${dot.ipo}">●</span> 청약 · <span style="color:var(--muted)">●</span> 참고</p></div>
  <div class="card"><h2>🗓️ ${m + 1}월 일정</h2>${list || `<div class="muted small">이달은 일정이 없어요.</div>`}
    <p class="muted small">만기일·휴장일·보고서 마감일은 규칙으로 계산했고, '대략'이라고 적힌 건 보통 그 무렵이라는 뜻이에요. 휴장일은 거래소 공지로 바뀔 수 있어요. 종목별 실적 발표일은 회사가 알린 날짜(확정, 굵게)를 쓰고, 없으면 작년 이맘때 공시 날짜로 짐작한 '예상'이에요. ⭐ = 내 종목.</p></div>
  ${ofHtml}
  ${foot()}`;
}, "home");

// ───────── 🏠 홈 ─────────
// 오후 5시 계산이 늦어지면 알려 줌 (거래일 밤 9시가 지나도 오늘 자료가 아니면)
function lateBanner() {
  const md = META && META.date;
  if (!md) return "";
  const now = new Date(Date.now() + 9 * 3600e3);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const open = (x) => isOpen(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  if (!(open(d) && now.getUTCHours() >= 21)) d.setUTCDate(d.getUTCDate() - 1);
  for (let k = 0; k < 12 && !open(d); k++) d.setUTCDate(d.getUTCDate() - 1);
  const exp = d.toISOString().slice(0, 10);
  return md < exp ? `<div class="warnbox" style="margin:0 0 10px">⏳ AI 계산이 늦어지고 있어요. 지금 확률은 <b>${esc(md)}</b> 종가 기준이에요. 새 계산이 끝나면 저절로 바뀌어요.</div>` : "";
}
function myToday() {
  const fs = favs().map((c) => BYCODE.get(c)).filter(Boolean);
  if (!fs.length) return "";
  const ch = fs.map((s) => [s, priceOf(s).chg]).filter((x) => x[1] != null).sort((a, b) => b[1] - a[1]);
  const up = ch.filter((x) => x[1] > 0).length, dn = ch.filter((x) => x[1] < 0).length;
  const best = ch[0], worst = ch[ch.length - 1];
  const hi = fs.filter((s) => s["p" + H] != null && s["p" + H] >= 0.6).length;
  const nm = (x) => `<b>${esc(x[0].name)}</b> <span class="${cls(x[1])}">${pctTxt(x[1], 1)}</span>`;
  return `<a class="card" href="#/my" style="display:block"><h2>💼 내 종목 오늘 <small>관심 ${fs.length}개 ›</small></h2>
    <p class="small" style="margin:0"><b class="up">📈 ${up}개 오름</b> · <b class="down">📉 ${dn}개 내림</b>${fs.length - up - dn > 0 ? ` · 그대로 ${fs.length - up - dn}개` : ""}</p>
    <p class="small" style="margin:4px 0 0">${best && best[1] > 0 ? `가장 많이 오른 ${nm(best)}` : ""}${best && best[1] > 0 && worst && worst[1] < 0 ? " · " : ""}${worst && worst[1] < 0 ? `가장 많이 내린 ${nm(worst)}` : ""}</p>
    <p class="small muted" style="margin:4px 0 0">🤖 ${H}일 뒤 상승 확률 60% 넘는 종목 ${hi}개</p></a>`;
}

route(/^\/$/, async () => {
  const [, , ij] = await Promise.all([loadIndex(), loadLive(), getJSON(IDXP, 600000).catch(() => null)]);
  const idx = (LIVEJ && LIVEJ.idx) || {};
  const mk = ["KOSPI", "KOSDAQ"].map((k) => {
    const v = idx[k];
    return `<div class="stat"><small>${k === "KOSPI" ? "코스피" : "코스닥"}</small>
      <b>${v ? v[0].toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "-"}</b>
      <div class="${cls(v && v[1])}">${v ? pctTxt(v[1]) : ""}</div>${idxProb(ij, k)}</div>`;
  }).join("");
  const ok = INDEX.filter((s) => s["p" + H] != null && !s.managed && !s.alert && !halt(s) && !s.name.includes("스팩"));
  const top = [...ok].sort((a, b) => b["p" + H] - a["p" + H]).slice(0, 10);
  const rec = store.get("ss-recent", []).map((c) => BYCODE.get(c)).filter(Boolean).slice(0, 5);
  const [sc, ih, al] = await Promise.all([scorecardHtml(true), issueHome(), myAlerts().catch(() => [])]);
  return `
  ${catBar()}${lateBanner()}${myToday()}
  <a class="card" href="#/brief" style="display:block"><h2 style="margin:0">☀️ 아침 브리핑 <small>›</small></h2>
    <p class="small muted" style="margin:4px 0 0">어젯밤 미국 증시 · 코스피 확률 · 오늘 일정 · 어제 AI 성적을 한 화면에</p></a>
  <div class="card"><a href="#/market" style="display:block"><h2>📊 오늘 시장 <small>${esc(marketState())} · ${esc(liveLabel())} ›</small></h2><div class="mkt">${mk}</div></a>
    ${ij && ij.KOSPI ? `<details class="note"><summary class="small muted">ⓘ 🤖 확률은 뭐예요?</summary>${idxNote(ij)}</details>` : ""}</div>
  ${alertHtml(al, 3)}${ih}${sc}
  <div class="toolbar">${segH()}<span class="muted small">AI 기준일 ${esc(META?.date || "-")}</span></div>
  <div class="card"><h2>⭐ 관심 종목 <a class="small muted" href="#/my">전체 ›</a></h2>${favList(5)}</div>
  <div class="card"><h2>🔥 ${H}일 뒤 상승 확률 TOP 10 <a class="small muted" href="#/rank?up">더 보기 ›</a></h2>
    ${top.map((s, i) => stockRow(s, { rank: i + 1, move: "up" })).join("")}
    <p class="muted small">관리종목·투자주의·거래정지 종목과 스팩은 뺐어요. 적중 = 최근 60번 예측 중 맞힌 비율. ▲▼ = 어제 순위와 비교 (🆕 = 어제 100위 밖).</p></div>
  ${rec.length ? `<div class="card"><h2>🕘 최근 본 종목</h2>${rec.map((s) => stockRow(s)).join("")}</div>` : ""}
  <div class="card"><h2>❓ 처음이신가요?</h2>
    <p class="small" style="margin:0">위 검색창에 종목 이름을 넣으면 AI가 1·5·20거래일 뒤 오를 확률을 보여 줘요.
    매일 오후 5시에 전 종목을 다시 계산하고, 장중 가격은 20분마다 새로 고쳐요.
    <a href="/guide.html" style="text-decoration:underline">사용 설명서</a>${inApp() ? "" : ` · <a href="#/more" style="text-decoration:underline">📱 안드로이드 앱 받기</a>`}</p></div>
  ${foot()}`;
}, "home");

// ───────── 📈 종목 분석 ─────────
// ───────── 📏 평소 흔들림 범위 (차트 자료로 앱에서 바로 계산) ─────────
const qtl = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
function swayHtml(ch, now, chgNow) {
  const C = ch.c, Hh = ch.h, L = ch.l, N = Math.min(120, C.length - 1);
  if (N < 40) return "";
  const r1 = [], rng = [], r5 = [];
  for (let i = C.length - N; i < C.length; i++) {
    if (C[i - 1] > 0) { r1.push(Math.abs(C[i] / C[i - 1] - 1) * 100); rng.push((Hh[i] - L[i]) / C[i - 1] * 100); }
    if (i - 5 >= 0 && C[i - 5] > 0) r5.push(Math.abs(C[i] / C[i - 5] - 1) * 100);
  }
  const mid = qtl(r1, 0.5), p80 = qtl(r1, 0.8), p95 = qtl(r1, 0.95), w80 = qtl(r5, 0.8), rg = qtl(rng, 0.5);
  const a = chgNow == null ? null : Math.abs(chgNow);
  const verdict = a == null ? "" : a <= p80 ? `오늘 <b class="${cls(chgNow)}">${pctTxt(chgNow, 1)}</b>는 <b>평소 범위 안</b>이에요. 흔한 움직임이에요.`
    : a <= p95 ? `오늘 <b class="${cls(chgNow)}">${pctTxt(chgNow, 1)}</b>는 <b>평소보다 큰 편</b>이에요. 20일에 2~3번 나오는 정도예요.`
      : `오늘 <b class="${cls(chgNow)}">${pctTxt(chgNow, 1)}</b>는 <b>평소 범위를 크게 벗어났어요</b>. 20일에 1번도 드문 움직임이라 이유(뉴스·공시)를 확인해 보세요.`;
  const stop = now ? Math.round(now * (1 - 2 * p80 / 100)) : null;
  const bar = (v, max) => `<div class="track2" style="height:8px"><i style="left:0;width:${Math.min(v / max, 1) * 100}%;background:var(--accent,#5b8def)"></i></div>`;
  const mx = Math.max(p95, a || 0) * 1.1;
  return `<div class="card"><h2>📏 평소 흔들림 범위 <small>최근 ${N}거래일</small></h2>
    ${verdict ? `<div class="sumbox">${verdict}</div>` : ""}
    <div class="bars">${[["보통 날", mid], ["10번 중 8번", p80], ["큰 날", p95], ...(a != null ? [["오늘", a]] : [])].map(([k, v]) =>
      `<div class="b"><span>${k}</span>${bar(v, mx)}<span>±${v.toFixed(1)}%</span></div>`).join("")}</div>
    <div class="split" style="margin-top:8px"><div class="stat"><small>하루 고가~저가 폭</small><b>${rg.toFixed(1)}%</b><div class="small muted">보통 날 기준</div></div>
      <div class="stat"><small>일주일(5거래일) 흔들림</small><b>±${w80.toFixed(1)}%</b><div class="small muted">10번 중 8번은 이 안</div></div></div>
    ${stop ? `<p class="small" style="margin:8px 0 0">✂️ 손절선 참고: 평소 흔들림의 2배 아래인 <b>${won(stop)}원</b> (−${(2 * p80).toFixed(1)}%) 밑으로 내려가면 '평소 흔들림'이 아닐 가능성이 커요.</p>` : ""}
    <p class="muted small">하루 등락률의 크기(오름·내림 모두)를 최근 ${N}거래일 동안 모아 계산했어요. '10번 중 8번' 안의 움직임은 이 종목에겐 흔한 일이에요. 손절선은 참고용 계산이에요.</p></div>`;
}

function swayLv(ch, chg) {
  const C = ch && ch.c, N = C ? Math.min(120, C.length - 1) : 0;
  if (N < 40 || chg == null) return null;
  const r = [];
  for (let i = C.length - N; i < C.length; i++) if (C[i - 1] > 0) r.push(Math.abs(C[i] / C[i - 1] - 1) * 100);
  const a = Math.abs(chg);
  return a <= qtl(r, 0.8) ? 0 : a <= qtl(r, 0.95) ? 1 : 2;
}

route(/^\/s\/([0-9A-Z]{6})/, async (code) => {
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
  const flHtml = fl.some((x) => x[1] != null) ? `<p class="small" style="margin:0 0 4px"><b>평소 거래량 대비</b> <small class="muted">최근 5일, 전날까지</small></p><div class="bars">
    ${fl.map(([n, v]) => {
      if (v == null) return `<div class="b"><span>${n}</span><div class="track2"></div><span>-</span></div>`;
      const w = Math.min(Math.abs(v) / 0.2, 1) * 50;
      return `<div class="b"><span>${n}</span><div class="track2"><i style="${v >= 0 ? `left:50%;width:${w}%;background:var(--up)` : `right:50%;width:${w}%;background:var(--down)`}"></i></div>
        <span class="${cls(v)}">${flPct(v)}</span></div>`;
    }).join("")}</div>
    <p class="muted small">하루 평균 순매수량 ÷ 평소 하루 거래량. +면 사는 쪽, −면 파는 쪽이 많았어요. AI도 이 값을 함께 봐요.</p>` : "";

  // 테마
  const TH = d.themes && d.themes.length ? await getJSON(DATA + "themes.json", 3600000).catch(() => null) : null;
  const thOf = (no) => (TH ? TH.find((x) => String(x.no) === String(no)) : null);
  const thChips = d.themes && d.themes.length ? [...d.themes]
    .sort((a, b) => ((thOf(b[0]) || {}).chg ?? -999) - ((thOf(a[0]) || {}).chg ?? -999)).map(([no, name, roles]) => {
      const t = thOf(no);
      return `<a class="chip" href="#/t/${no}">${[...(roles || "")].map((r) => ROLE[r][0]).join("")}${esc(name)}${t ? ` <span class="${cls(t.chg)}">${pctTxt(t.chg, 1)}</span> <small class="muted">${t.stocks.length}종목</small>` : ""}</a>`;
    }) : [];
  const thHtml = thChips.length ? `<div class="card"><h2>🧩 속한 테마 <small>${thChips.length}개 · 오늘 많이 오른 순</small></h2><div class="chips">${thChips.slice(0, 6).join("")}</div>
    ${thChips.length > 6 ? `<details style="margin-top:6px"><summary class="small">테마 ${thChips.length - 6}개 더 보기</summary><div class="chips" style="margin-top:6px">${thChips.slice(6).join("")}</div></details>` : ""}
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
      ${FL ? `<div class="follow">🧪 최근 1년 <b>AI 따라 했다면 <span class="${cls(FL.s)}">${pctTxt(FL.s * 100, 1)}</span></b> · 그냥 갖고 있었다면 ${pctTxt(FL.hd * 100, 1)} <small class="muted">(자세히: AI 성적)</small></div>` : ""}`;
  }

  // 한눈에 칩 (누르면 그 탭으로)
  const chip = (ic, t, go) => `<button class="chip" data-go="${go}">${ic} ${t}</button>`;
  const chipArr = [];
  if (top != null) chipArr.push(top <= 30 ? chip("🟢", "적중률 좋음", "ai") : top >= 70 ? chip("🔴", "적중률 낮음", "ai") : chip("🟡", "적중률 보통", "ai"));
  const sl = swayLv(d.chart, pr.chg);
  if (sl != null) chipArr.push(chip(["🟢", "🟡", "🔴"][sl], ["평소 같은 움직임", "오늘 큰 움직임", "오늘 아주 큰 움직임"][sl], "chart"));
  const ff = ind.fl_frg5;
  if (ff != null) chipArr.push(ff >= 0.02 ? chip("🟢", "외국인 매수", "flow") : ff <= -0.02 ? chip("🔴", "외국인 매도", "flow") : chip("🟡", "외국인 보통", "flow"));
  if (d.news && d.news.length) chipArr.push(chip(nscore >= 0.1 ? "🟢" : nscore <= -0.1 ? "🔴" : "🟡", "뉴스 " + mood.split(" ").pop(), "flow"));
  const chipsHtml = `<div class="chips sumchips" id="sumchips">${chipArr.join("")}<span id="chip-fin"></span><span id="chip-ovh"></span></div>`;

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
  const DUP = ["매출 성장률", "영업이익 성장률", "부채비율"]; // 전자공시 '실적 한눈에'가 있으면 그쪽만 보여 줌 (기준이 달라 숫자가 헷갈림)
  const finGrid = finRows.some((x) => x[1] != null && !isNaN(x[1])) ? `<p class="small" style="margin:10px 0 4px"><b>📑 재무 지표</b> <small class="muted">네이버 · 최근 1년 결산 기준</small></p><div class="fin">${finRows.filter((x) => x[1] != null && !isNaN(x[1]))
    .map(([k, v, fm]) => `<div class="stat"${DUP.includes(k) ? " data-dup" : ""}><small>${k}</small><b style="font-size:15px">${fm(v)}</b></div>`).join("")}</div>` : "";
  const flowCard = flHtml || deal.length ? `<div class="card"><h2>🤝 외국인·기관·개인 매매</h2>${flHtml}
    ${deal.length ? `<p class="small" style="margin:12px 0 4px"><b>최근 ${deal.length}거래일 사고판 주식 수</b></p>${dealHtml}` : ""}</div>` : "";
  const finHtml = `<div class="card"><h2>🏢 기업 정보</h2>${infoHtml}${finGrid}
    <p class="small" style="margin:12px 0 4px"><b>🎯 증권사 목표주가</b></p>${consHtml}
    <p class="small" style="margin:12px 0 4px"><b>📅 실적 발표 일정</b></p><div id="irbox">${irHtml}</div>
    <p class="muted small">네이버 증권 자료(매일 오후 5시 기준). 적자 기업은 PER이 '-'로 나와요. AI 확률 계산에는 쓰지 않는 참고 정보예요.</p></div>`;

  const STABS = [["ai", "🤖 AI"], ["chart", "📈 차트"], ["fin", "📊 실적·공시"], ["flow", "🤝 수급·뉴스"], ["tool", "🧰 도구"]];
  let stab = store.get("ss-stab", "ai");
  if (!STABS.some((t) => t[0] === stab)) stab = "ai";
  const pane = (k, html) => `<div class="pane" data-pane="${k}"${k === stab ? "" : " hidden"}>${html}</div>`;
  after(() => {
    const redraw = () => drawChart($("#chart"), d.chart, store.get("ss-range", 120), store.get("ss-ctype", "d") === "w");
    const bar = document.querySelector(".bar");
    if (bar) document.documentElement.style.setProperty("--barh", bar.offsetHeight + "px");
    const inited = new Set(), init = { ai: () => simSection(code), fin: () => dartSection(code, !!d.ir) };
    const showTab = (k, jump) => {
      stab = k; store.set("ss-stab", k);
      document.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== k; });
      document.querySelectorAll("#stabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === k));
      if (k === "chart") redraw();
      else if (!inited.has(k) && init[k]) init[k]();
      inited.add(k);
      const t = $("#stabs");
      if (t && jump) {
        const y = t.getBoundingClientRect().top + scrollY - (bar ? bar.offsetHeight : 0);
        if (scrollY > y || jump === "go") window.scrollTo({ top: y, behavior: jump === "go" ? "smooth" : "auto" });
      }
    };
    document.querySelectorAll("#stabs button").forEach((b) => b.onclick = () => showTab(b.dataset.tab, true));
    $("#sumchips").onclick = (e) => { const b = e.target.closest("[data-go]"); if (b) showTab(b.dataset.go, "go"); };
    DART(`d/${code}.json`).then((x) => {
      if (!x.q || !x.q.q || !x.q.q.length) return;
      const L = finLights(x.q), r = L.filter((l) => l[0] === "🔴").length, g = L.filter((l) => l[0] === "🟢").length;
      const el = $("#chip-fin");
      if (el) el.outerHTML = r >= 2 ? chip("🔴", "실적 주의", "fin") : r === 0 && g >= 2 ? chip("🟢", "실적 좋음", "fin") : chip("🟡", "실적 보통", "fin");
    }).catch(() => {});
    DART("ovh.json").then((O) => {
      const rows = O.s[code];
      if (!rows || !rows.length) return;
      const o = ovhCalc(rows, pr.now), [ic, lv] = ovhLevel(o), el = $("#chip-ovh");
      if (el && o.items.length && ic !== "🟢") el.outerHTML = chip(ic, "물량 부담 " + lv, "flow");
    }).catch(() => {});
    document.querySelectorAll("[data-ctype]").forEach((b) => b.onclick = () => {
      store.set("ss-ctype", b.dataset.ctype);
      document.querySelectorAll("[data-ctype]").forEach((x) => x.classList.toggle("on", x === b));
      redraw();
    });
    $("#fav").onclick = () => { const on = toggleFav(code); $("#fav").textContent = on ? "★" : "☆"; };
    $("#share").onclick = () => share(d.name, code, P);
    $("#shareimg").onclick = () => (P ? shareImg(d, P, pr) : toast("확률이 없는 종목은 이미지를 만들 수 없어요"));
    moveSection(d, TH);
    document.querySelectorAll("[data-range]").forEach((b) => b.onclick = () => {
      store.set("ss-range", +b.dataset.range);
      document.querySelectorAll("[data-range]").forEach((x) => x.classList.toggle("on", x === b));
      redraw();
    });
    $("#indbox").addEventListener("toggle", (e) => { if (e.target.open) indTable(d); }, { once: true });
    whySection(d);
    tgtBind(code, pr.now);
    ovhSection(code, pr.now);
    showTab(stab);
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
  const rg = store.get("ss-range", 120), ct = store.get("ss-ctype", "d");
  return `
  <div class="card">
    <div class="head"><div><h1>${esc(d.name)}${flags}</h1><div class="muted small">${code} · ${d.market === "KOSPI" ? "코스피" : "코스닥"}</div></div>
      <div style="display:flex;gap:6px"><button class="icon-btn" id="shareimg" aria-label="이미지로 공유">🖼</button><button class="icon-btn" id="share" aria-label="공유">공유</button>
      <button class="icon-btn" id="fav" aria-label="내 종목" style="font-size:18px;padding:3px 10px">${fav ? "★" : "☆"}</button></div></div>
    <div class="price" style="margin-top:8px"><b>${won(pr.now)}원</b><span class="${cls(pr.chg)}">${pctTxt(pr.chg)}</span>
      <small class="muted">${pr.live ? esc(liveLabel()) : `${esc(d.date)} 종가`}</small></div>
  </div>
  <div class="card"><div style="text-align:center;margin-bottom:6px">${segH()}</div>${probHtml}
    <p class="muted small" style="text-align:center">AI 기준일 ${esc(d.date)} 종가 · 매일 오후 5시 새로 계산</p>${sumHtml}${chipsHtml}</div>
  <div class="stabs" id="stabs">${STABS.map(([k, l]) => `<button data-tab="${k}" class="${k === stab ? "on" : ""}">${l}</button>`).join("")}</div>
  ${pane("ai", `<div id="whybox"></div>
    <div class="card"><h2>🎯 이 종목 AI 성적 <small>${H}일 뒤</small></h2>${statHtml}${trackHtml}${moreAi}</div>
    ${voteHtml}<div id="simbox"></div>
    <div class="card"><details id="indbox"><summary>🧮 AI가 본 지표 50가지</summary><div id="indt" class="loading">불러오는 중…</div></details></div>`)}
  ${pane("chart", `<div class="card"><h2>📈 주가 <span class="seg">${[[20, "1개월"], [60, "3개월"], [120, "6개월"], [260, "1년"]].map(([k, l]) => `<button data-range="${k}" class="${k === rg ? "on" : ""}">${l}</button>`).join("")}</span></h2>
    <div class="seg" style="margin:0 0 6px">${[["d", "일봉"], ["w", "주봉"]].map(([k, l]) => `<button data-ctype="${k}" class="${k === ct ? "on" : ""}">${l}</button>`).join("")}</div>
    <canvas id="chart" height="230"></canvas><p class="muted small" id="chartinfo"></p></div>
    ${swayHtml(d.chart, pr.now, pr.chg)}<div id="movebox"></div>`)}
  ${pane("fin", `<div id="dartbox"></div>${finHtml}`)}
  ${pane("flow", `${flowCard}<div id="ovhbox"></div>${thHtml}${newsHtml}`)}
  ${pane("tool", `${tgtCard(code, pr.now)}
    <div class="split" style="margin:0 0 10px"><a class="more" href="#/calc?${code}" style="text-align:center;margin:0">🧮 물타기·손익 계산</a><a class="more" href="#/paper?${code}" style="text-align:center;margin:0">🎮 가상으로 사 보기</a></div>
    <a class="more" href="#/cmp?${code}-" style="text-align:center;margin:0 0 10px">🆚 다른 종목과 비교하기</a>`)}
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

// 일봉 → 주봉 (월~금 한 주를 봉 하나로: 시작 = 첫날 시가, 마감 = 마지막 날 종가, 거래량 = 합계)
function toWeeks(ch) {
  const w = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let key = null;
  ch.c.forEach((c, i) => {
    const s = String(ch.d[i]).padStart(6, "0");
    const dt = new Date(2000 + +s.slice(0, 2), +s.slice(2, 4) - 1, +s.slice(4));
    const mon = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - ((dt.getDay() + 6) % 7)).getTime();
    const o = ch.o ? ch.o[i] : c, h = ch.h ? ch.h[i] : c, l = ch.l ? ch.l[i] : c, v = ch.v[i] || 0;
    if (mon !== key) {
      key = mon;
      w.d.push(ch.d[i]); w.o.push(o); w.h.push(h); w.l.push(l); w.c.push(c); w.v.push(v);
    } else {
      const k = w.c.length - 1;
      w.d[k] = ch.d[i]; w.h[k] = Math.max(w.h[k], h); w.l[k] = Math.min(w.l[k], l); w.c[k] = c; w.v[k] += v;
    }
  });
  return w;
}
const CHART_TXT = (wk) => `봉 하나 = ${wk ? "한 주" : "하루"} 가격 (<span class="up">빨강</span> 오름 · <span class="down">파랑</span> 내림, 가는 선은 최고·최저) · <span style="color:#f59e0b">주황</span> ${wk ? "5주" : "20일"} 평균 · <span style="color:#8b5cf6">보라</span> ${wk ? "20주" : "60일"} 평균 · 아래 막대 = 거래량`;

// 차트 (봉 차트: 빨강 = 오른 날, 파랑 = 내린 날 + 평균선 + 거래량). wk = 주봉
function drawChart(cv, ch, n, wk) {
  if (!cv || !ch || !ch.c.length) return;
  if (wk) { ch = toWeeks(ch); n = Math.max(8, Math.ceil(n / 5)); }
  $("#chartinfo").innerHTML = CHART_TXT(wk);
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  const ma = (k) => ch.c.map((_, i) => (i + 1 < k ? null : ch.c.slice(i + 1 - k, i + 1).reduce((a, b) => a + b, 0) / k));
  const m20 = ma(wk ? 5 : 20), m60 = ma(wk ? 20 : 60);
  const st = Math.max(0, ch.c.length - n);
  const cut = (a) => (a || ch.c).slice(st);
  const C = cut(ch.c), O = cut(ch.o), Hi = cut(ch.h), Lo = cut(ch.l), V = cut(ch.v), D = cut(ch.d), A = m20.slice(st), B = m60.slice(st);
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, Hh = 250;
  cv.width = W * dpr; cv.height = Hh * dpr; cv.style.height = Hh + "px";
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const pad = { l: 4, r: 56, t: 8, b: 18 }, vh = 40;
  const ph = Hh - pad.t - pad.b - vh - 6;
  const all = Hi.concat(Lo, A.filter((x) => x != null), B.filter((x) => x != null)).filter((x) => x != null);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; }
  const step = (W - pad.l - pad.r) / C.length;
  const x = (i) => pad.l + step * (i + 0.5);
  const y = (v) => pad.t + ph * (1 - (v - lo) / (hi - lo));
  const bw = Math.max(1, Math.min(14, step * 0.7));
  const upDay = (i) => C[i] > O[i] || (C[i] === O[i] && i > 0 && C[i] >= C[i - 1]);
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
    V.forEach((v, i) => {
      g.fillStyle = upDay(i) ? col("--up") : col("--down");
      g.globalAlpha = 0.4;
      const hgt = vh * v / vmax;
      g.fillRect(x(i) - bw / 2, vb - hgt, bw, hgt);
    });
    g.globalAlpha = 1;
    // 봉: 가는 선 = 그날 최고~최저, 두꺼운 몸통 = 시작~마감 가격
    C.forEach((c, i) => {
      const o = O[i] ?? c, h = Hi[i] ?? Math.max(o, c), l = Lo[i] ?? Math.min(o, c);
      const color = upDay(i) ? col("--up") : col("--down");
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(x(i)) + 0.5, y(h)); g.lineTo(Math.round(x(i)) + 0.5, y(l)); g.stroke();
      const top = y(Math.max(o, c)), bot = y(Math.min(o, c));
      g.fillRect(x(i) - bw / 2, top, bw, Math.max(1, bot - top));
    });
    const line = (arr, color, w) => {
      g.strokeStyle = color; g.lineWidth = w; g.beginPath();
      let on = false;
      arr.forEach((v, i) => { if (v == null) return; on ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)); on = true; });
      g.stroke();
    };
    line(B, "#8b5cf6", 1.2);
    line(A, "#f59e0b", 1.2);
    g.fillStyle = col("--muted");
    g.fillText(ymd(D[0]), pad.l, Hh - 4);
    const last = ymd(D[D.length - 1]);
    g.fillText(last, W - pad.r - g.measureText(last).width, Hh - 4);
    if (hover != null) {
      g.strokeStyle = col("--fg"); g.lineWidth = 0.7; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x(hover), pad.t); g.lineTo(x(hover), Hh - pad.b); g.stroke(); g.setLineDash([]);
    }
  }
  frame(null);
  const info = $("#chartinfo"), base = info.innerHTML;
  const at = (e) => {
    const r = cv.getBoundingClientRect();
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    return Math.max(0, Math.min(C.length - 1, Math.floor((px - pad.l) / step)));
  };
  const show = (e) => {
    const i = at(e);
    frame(i);
    const ch1 = i ? (C[i] / C[i - 1] - 1) * 100 : null;
    info.innerHTML = `<b>${ymd(D[i])}${wk ? " 주" : ""}</b> 종가 ${won(C[i])}원 <span class="${cls(ch1)}">${pctTxt(ch1)}</span><br>시작 ${won(O[i])} · 최고 ${won(Hi[i])} · 최저 ${won(Lo[i])} · 거래량 ${won(V[i])}${!wk && MOVEMAP.get(D[i]) ? `<br>📰 ${esc(MOVEMAP.get(D[i]))}` : ""}`;
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
// 🎯 목표가 알림 카드 (종목 화면)
function tgtCard(code, now) {
  const t = tgts()[code] || [null, null], th = tgtHit(code, now);
  const gap = (v) => (v && now ? ` <small class="muted">(지금보다 ${pctTxt((v / now - 1) * 100, 1)})</small>` : "");
  return `<div class="card"><h2>🎯 목표가 알림 ${t[0] || t[1] ? `<small>${th ? "🎯 도달!" : "기다리는 중"}</small>` : ""}</h2>
    <div class="split"><label class="small">📈 이 가격 <b>이상</b>이면${gap(t[0])}<input id="tgu" class="num" type="number" inputmode="numeric" placeholder="예: ${won(Math.round(now * 1.1 / 10) * 10)}" value="${t[0] || ""}"></label>
      <label class="small">📉 이 가격 <b>이하</b>면${gap(t[1])}<input id="tgd" class="num" type="number" inputmode="numeric" placeholder="예: ${won(Math.round(now * 0.9 / 10) * 10)}" value="${t[1] || ""}"></label></div>
    <div class="split" style="margin-top:6px"><button class="more" id="tgsave">저장</button>${t[0] || t[1] ? `<button class="more" id="tgdel">지우기</button>` : ""}</div>
    <p class="muted small">장중(9시~3시 반) 20분마다 확인해서, 정한 가격에 닿으면 휴대폰 알림을 보내요. 같은 가격 알림은 한 번만 가요. 알림을 받으려면 내 종목 화면에서 '🔔 알림 켜기'를 해 주세요 (안 켜도 앱을 열면 내 종목 알림에 보여요).</p></div>`;
}
function tgtList() {
  const T = Object.entries(tgts());
  if (!T.length) return "";
  return `<div class="card"><h2>🎯 내 목표가 알림 <small>${T.length}종목</small></h2>
    ${T.map(([c, [u, dd]]) => {
      const s = BYCODE.get(c), now = s ? priceOf(s).now : null, th = tgtHit(c, now);
      return `<a class="row" href="#/s/${c}" style="padding:6px 0"><div class="nm"><b>${th ? "🎯 " : ""}${esc(s ? s.name : c)}</b>
        <small>${u ? `📈 ${won(u)}원 이상` : ""}${u && dd ? " · " : ""}${dd ? `📉 ${won(dd)}원 이하` : ""}${now ? ` · 지금 ${won(now)}원` : ""}${th ? " · <b>도달</b>" : ""}</small></div></a>`;
    }).join("")}
    <p class="muted small">바꾸거나 지우려면 종목을 눌러 그 화면의 '🎯 목표가 알림'에서 하세요.</p></div>`;
}
function tgtBind(code, now) {
  const sv = $("#tgsave");
  if (!sv) return;
  sv.onclick = () => {
    const num = (id) => { const v = Math.round(+$(id).value); return v > 0 ? v : null; };
    const up = num("#tgu"), dn = num("#tgd");
    if (up && now && up <= now) return toast("'이상' 가격은 지금 가격보다 높게 정해 주세요");
    if (dn && now && dn >= now) return toast("'이하' 가격은 지금 가격보다 낮게 정해 주세요");
    const all = tgts();
    if (!up && !dn) delete all[code]; else all[code] = [up, dn];
    if (Object.keys(all).length > 30) return toast("목표가 알림은 30종목까지 정할 수 있어요");
    store.set("ss-tgt", all); pushSync();
    toast(up || dn ? "🎯 목표가를 저장했어요" : "목표가를 지웠어요"); render();
  };
  const dl = $("#tgdel");
  if (dl) dl.onclick = () => { const all = tgts(); delete all[code]; store.set("ss-tgt", all); pushSync(); toast("목표가를 지웠어요"); render(); };
}

// ❓ 왜 이 확률? — 영향이 큰 지표 3개 (그 지표가 보통 종목 수준이면 확률이 얼마나 달라지나)
const FL_NAME = { fl_frg5: "외국인 매매(5일)", fl_org5: "기관 매매(5일)", fl_ind5: "개인 매매(5일)" };
async function whySection(d) {
  const box = $("#whybox");
  const w = d.why && d.why[String(H)];
  if (!box || !w || !w.length) return;
  let names = {};
  try {
    const I = await getJSON(DATA + "ind.json", 3600000);
    for (const t of Object.values(I.table || {})) for (const [, name, , , cols] of t) for (const c of cols || []) names[c] = name;
  } catch { /* 이름 없이 */ }
  const nm = (c) => FL_NAME[c] || names[c] || (c.startsWith("fl_") ? "수급(외국인·기관·개인)" : c.startsWith("er_") || c.startsWith("fin_") ? "실적·재무(전자공시)" : "기타 지표");
  const mx = Math.max(...w.map((x) => Math.abs(x[1])), 0.01);
  box.innerHTML = `<div class="card"><h2>❓ 왜 이 확률인가요? <small>${H}일 뒤</small></h2>
    ${w.map(([c, v]) => {
      const up = v > 0, val = d.ind && d.ind[c] != null ? ` · 지금 ${fmtInd(c, d.ind[c])}` : "";
      return `<div style="margin:8px 0"><div class="small"><b>${up ? "⬆️" : "⬇️"} ${esc(nm(c))}</b><span class="muted">${esc(val)}</span>
        <span class="${up ? "up" : "down"}" style="float:right">${up ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%p</span></div>
        <div style="height:6px;background:var(--line);border-radius:3px"><div style="height:6px;width:${Math.round(Math.abs(v) / mx * 100)}%;background:var(--${up ? "up" : "down"});border-radius:3px"></div></div></div>`;
    }).join("")}
    <p class="muted small">그 지표가 '보통 종목 수준'이었다면 확률이 얼마나 달랐을지 계산했어요. ⬆️는 확률을 올린 이유, ⬇️는 내린 이유예요. 여러 지표가 함께 작용하니 참고만 하세요.</p></div>`;
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
    const dk = Object.keys(imp).filter((c) => c.startsWith("er_") || c.startsWith("fin_"));
    if (dk.length) {
      rows.unshift(`<tr><td>+</td><td><b>실적 발표·재무 (전자공시)</b> <small class="muted">공시</small><br><small class="muted">실적 발표 전후 시점, 매출·이익 증가, 이익률, 부채비율 (공시 다음 날부터 반영)</small></td>
        <td class="r">✅ ${(dk.reduce((a, c) => a + imp[c], 0) * 100).toFixed(1)}%</td></tr>`);
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
  let list = INDEX.filter((s) => s[k] != null && !halt(s));
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

// ───────── 🏛️ 전자공시 자료: 실적 한눈에 · 최근 공시 · 임원·대주주 · 배당 · 실적 발표 일정 ─────────
const eok = (v) => (v == null ? "-" : Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "조" : Math.round(v).toLocaleString("ko-KR") + "억");
const amtTxt = (v) => (v == null ? "" : Math.abs(v) < 0.0001 ? "1만원 미만" : Math.abs(v) < 1 ? `약 ${Math.round(Math.abs(v) * 10000).toLocaleString("ko-KR")}만원` : `약 ${eok(Math.abs(v))}원`);
const DART = (p) => getJSON(DATA + p, 3600000);
const ddays = (iso) => Math.round((new Date(iso) - new Date(todayKST())) / 864e5);

// 분기 막대 (0 기준선, 위 = 흑자, 아래 = 적자)
function drawQ(cv, labels, vals, opt = {}) {
  if (!cv || !labels.length) return;
  const css = getComputedStyle(document.documentElement);
  const col = (v) => (v.startsWith("--") ? css.getPropertyValue(v).trim() : v);
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = opt.h || 140;
  cv.width = W * dpr; cv.height = Hh * dpr; cv.style.height = Hh + "px";
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  const pad = { l: 2, r: 2, t: 16, b: 18 }, ph = Hh - pad.t - pad.b;
  const vs = vals.filter((v) => v != null);
  const hi = Math.max(0, ...vs), lo = Math.min(0, ...vs), span = hi - lo || 1;
  const step = (W - pad.l - pad.r) / labels.length, bw = Math.max(4, Math.min(26, step * 0.6));
  const y = (v) => pad.t + ph * (1 - (v - lo) / span);
  g.font = "10px sans-serif"; g.textAlign = "center";
  g.strokeStyle = col("--line"); g.beginPath(); g.moveTo(pad.l, y(0)); g.lineTo(W - pad.r, y(0)); g.stroke();
  vals.forEach((v, i) => {
    const x = pad.l + step * (i + 0.5);
    g.fillStyle = col("--muted"); g.fillText(labels[i], x, Hh - 4);
    if (v == null) return;
    g.fillStyle = col(v >= 0 ? (opt.color || "--up") : "--down");
    const a = y(Math.max(0, v)), b = y(Math.min(0, v));
    g.fillRect(x - bw / 2, a, bw, Math.max(1, b - a));
    g.fillStyle = col("--fg"); g.fillText(eok(v), x, v >= 0 ? a - 3 : Math.min(b + 11, Hh - 16));
  });
}

// 🟢🟡🔴 재무 신호등
function finLights(q) {
  const L = [], rows = q.q || [];
  const last4 = rows.slice(-4).filter((r) => r[2] != null);
  if (last4.length) {
    const neg = last4.filter((r) => r[2] < 0).length;
    L.push([neg === 0 ? "🟢" : neg === 1 ? "🟡" : "🔴", "영업이익", neg === 0 ? `최근 ${last4.length}분기 모두 흑자` : `최근 ${last4.length}분기 중 ${neg}번 적자`]);
  }
  const cur = rows[rows.length - 1], prev = rows.length >= 5 ? rows[rows.length - 5] : null;
  if (cur && prev && cur[1] != null && prev[1]) {
    const g = cur[1] / prev[1] - 1;
    L.push([g > 0.05 ? "🟢" : g > -0.05 ? "🟡" : "🔴", `매출 (${cur[0]}, 1년 전보다)`, pctTxt(g * 100, 1)]);
  }
  if (cur && prev && cur[2] != null && prev[2] != null) {
    if (prev[2] <= 0 && cur[2] > 0) L.push(["🟢", `영업이익 (${cur[0]})`, "흑자로 돌아섬"]);
    else if (prev[2] > 0 && cur[2] <= 0) L.push(["🔴", `영업이익 (${cur[0]})`, "적자로 돌아섬"]);
    else if (prev[2] > 0) { const g = cur[2] / prev[2] - 1; L.push([g > 0.05 ? "🟢" : g > -0.05 ? "🟡" : "🔴", `영업이익 (${cur[0]}, 1년 전보다)`, pctTxt(g * 100, 1)]); }
    else L.push(["🔴", `영업이익 (${cur[0]})`, "적자 이어짐"]);
  }
  if (q.debt != null) L.push([q.debt < 100 ? "🟢" : q.debt < 200 ? "🟡" : "🔴", "부채비율", `${q.debt.toLocaleString("ko-KR")}%`]);
  return L;
}

const insRow = (r, link) => {
  const [date, who, role, chg, aft, rate, amt] = r.slice(-8);
  const head = link ? `${esc(link[1])} <small class="muted">${esc(who)}${role ? " · " + esc(role) : ""}</small>` : `${esc(who)} <small class="muted">${esc(role || "")}</small>`;
  return `<${link ? `a class="row" href="#/s/${link[0]}"` : `div class="row"`}><div class="nm"><b>${head}</b>
    <small>${date.slice(2).replace(/-/g, ".")} · 보유 ${aft != null ? won(aft) + "주" : "-"}${rate ? ` (${rate}%)` : ""}</small></div>
    <div class="rt"><b class="${cls(chg)}">${chg > 0 ? "+" : ""}${won(chg)}주</b><br><small class="muted">${amtTxt(amt)}</small></div></${link ? "a" : "div"}>`;
};
const INS_NOTE = "늘어난 주식에는 직접 산 것 말고 상여·스톡옵션·상속으로 받은 것도 섞여 있어요. 금액은 지금 가격으로 대략 계산했어요.";

async function dartSection(code, hasIr) {
  const box = $("#dartbox");
  if (!box) return;
  let x;
  try { x = await DART(`d/${code}.json`); } catch { box.innerHTML = ""; return; }
  if (!document.body.contains(box)) return;
  let h = "";
  const Q = x.q && x.q.q && x.q.q.length ? x.q.q : null;
  if (Q) {
    h += `<div class="card"><h2>📊 실적 한눈에 <small>분기별</small></h2>${qLine(Q)}
      <div class="fin">${finLights(x.q).map(([e, k, v]) => `<div class="stat"><small>${e} ${esc(k)}</small><b style="font-size:15px">${esc(v)}</b></div>`).join("")}</div>
      <p class="small" style="margin:12px 0 2px"><b>매출액</b></p><canvas id="q-s"></canvas>
      <p class="small" style="margin:12px 0 2px"><b>영업이익</b> <small class="muted">빨강 흑자 · 파랑 적자</small></p><canvas id="q-o"></canvas>
      <p class="muted small">전자공시(DART) 분기·반기·사업보고서 기준(연결 재무제표 우선). 4분기는 1년 실적에서 앞 세 분기를 빼서 계산했어요. 🟢 좋음 · 🟡 보통 · 🔴 주의</p></div>`;
  }
  if (x.div) {
    const v = x.div, ys = [v.year - 2, v.year - 1, v.year];
    h += `<div class="card"><h2>💰 배당 <small>${v.year}년 결산 기준</small></h2><div class="split">
      <div class="stat"><small>1주당 배당금</small><b>${won(v.dps[2])}원</b><div class="small muted">1년 동안 받은 현금</div></div>
      <div class="stat"><small>배당수익률</small><b>${v.yld != null ? v.yld.toFixed(2) + "%" : v.yld_rep != null ? v.yld_rep.toFixed(2) + "%" : "-"}</b><div class="small muted">${v.yld != null ? "지금 가격으로 샀다면" : "결산 당시 회사 보고"}</div></div>
      <div class="stat"><small>배당성향</small><b>${v.payout != null ? Math.round(v.payout) + "%" : "-"}</b><div class="small muted">순이익 중 배당 비율</div></div></div>
      <p class="small" style="margin:8px 0 0">최근 3년 1주당 배당금: ${ys.map((y, i) => `${y}년 <b>${v.dps[i] != null ? won(v.dps[i]) + "원" : "-"}</b>`).join(" → ")}</p>
      ${v.odd ? `<p class="small" style="margin:6px 0 0">⚠️ 그 뒤 주식 수가 바뀌었거나(분할 등) 자료가 맞지 않아, 지금 가격 기준 수익률은 계산하지 않았어요.</p>` : ""}
      <p class="muted small">사업보고서 기준이라 올해 배당은 달라질 수 있어요. <a href="#/div">💰 배당 순위 보기 ›</a></p></div>`;
  }
  if (x.ins && x.ins.length) {
    const up = x.ins.filter((r) => r[3] > 0).length, dn = x.ins.filter((r) => r[3] < 0).length;
    h += `<div class="card"><h2>👔 임원·대주주 주식 변동 <small>최근 6개월 · 늘림 ${up} · 줄임 ${dn}</small></h2>
      ${x.ins.slice(0, 6).map((r) => insRow(r)).join("")}
      ${x.ins.length > 6 ? `<details><summary>${x.ins.length - 6}건 더 보기</summary>${x.ins.slice(6).map((r) => insRow(r)).join("")}</details>` : ""}
      <p class="muted small">${INS_NOTE} <a href="#/ins">👔 전체 종목 보기 ›</a></p></div>`;
  }
  if (x.disc && x.disc.length) {
    const row = ([date, label, desc, tone, title, rno]) => `<a class="row" href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rno)}" target="_blank" rel="noopener">
      <div class="nm"><b>${tone > 0 ? "🟢 " : tone < 0 ? "🟠 " : ""}${esc(label)}</b><small>${date.slice(2).replace(/-/g, ".")} · ${esc(desc)}</small></div><div class="rt muted">›</div></a>`;
    h += `<div class="card"><h2>📰 최근 공시 <small>쉬운 설명</small></h2>
      ${x.disc.slice(0, 6).map(row).join("")}
      ${x.disc.length > 6 ? `<details><summary>${x.disc.length - 6}건 더 보기</summary>${x.disc.slice(6).map(row).join("")}</details>` : ""}
      <p class="muted small">누르면 전자공시(DART) 원문이 열려요. 🟢 보통 좋은 소식 · 🟠 주의할 소식 (주가가 꼭 그렇게 움직이는 건 아니에요)</p></div>`;
  }
  box.innerHTML = h;
  if (Q) {
    document.querySelectorAll("[data-dup]").forEach((e) => e.remove());
    const lb = Q.map((r) => r[0]);
    drawQ($("#q-s"), lb, Q.map((r) => r[1]), { color: "#8b9bb4" });
    drawQ($("#q-o"), lb, Q.map((r) => r[2]));
  }
  const ib = $("#irbox");
  if (!hasIr && x.er && ib) {
    const dd = ddays(x.er[0]);
    ib.innerHTML = `<p class="small">📢 다음 실적 발표 <b>${esc(x.er[0])}</b>${x.er[1] === "예상" ? " 무렵 (예상)" : ""} · ${dd === 0 ? "오늘" : "D-" + dd}<br><small class="muted">${esc(x.er[2])}</small></p>`;
  }
}

// ───────── 💰 배당 순위 ─────────
let divState = Object.assign({ by: "yld", safe: true }, store.get("ss-div", {})), divShow = 50;
route(/^\/div/, async () => {
  await loadIndex();
  let D;
  try { D = await DART("div.json"); } catch { return `<div class="card"><h2>💰 배당 순위</h2><p class="muted">배당 자료를 준비하고 있어요. 잠시 뒤 다시 와 주세요.</p></div>${foot()}`; }
  let list = D.rows.map(([code, name, dps, yld, year, payout, up]) => ({ code, name, dps, yld, year, payout, up, s: BYCODE.get(code) }))
    .filter((r) => r.s && !halt(r.s) && !(r.yld > 50));
  if (divState.safe) list = list.filter((r) => !r.s.managed && !r.s.alert);
  const k = divState.by === "dps" ? "dps" : "yld";
  list.sort((a, b) => (b[k] ?? -1) - (a[k] ?? -1));
  after(() => {
    document.querySelectorAll("[data-dv]").forEach((b) => b.onclick = () => { divState.by = b.dataset.dv; store.set("ss-div", divState); divShow = 50; render(); });
    $("#dsafe").onchange = (e) => { divState.safe = e.target.checked; store.set("ss-div", divState); render(); };
    const m = $("#dvmore"); if (m) m.onclick = () => { divShow += 50; render(); };
  });
  const rows = list.slice(0, divShow).map((r, i) => `<a class="row" href="#/s/${r.code}"><div class="nm"><b>${i + 1}. ${esc(r.name)}</b>
    <small>${k === "yld" ? `1주당 ${won(r.dps)}원` : `배당수익률 ${r.yld != null ? r.yld.toFixed(2) + "%" : "-"}`} · ${r.year}년 결산${r.payout != null ? ` · 배당성향 ${Math.round(r.payout)}%` : ""}${r.up >= 2 ? " · 📈 2년 연속 늘림" : ""}${r.payout != null && r.payout < 0 ? " · ⚠️ 적자인데 배당" : r.payout > 100 ? " · ⚠️ 번 돈보다 많이 줌" : ""}</small></div>
    <div class="rt"><b>${k === "yld" ? (r.yld != null ? r.yld.toFixed(2) + "%" : "-") : won(r.dps) + "원"}</b><br><small class="muted">${k === "yld" ? "배당수익률" : "1주당"}</small></div></a>`).join("");
  return `<div class="toolbar"><div class="seg">${[["yld", "💹 배당수익률 순"], ["dps", "💵 배당금 순"]].map(([v, l]) => `<button data-dv="${v}" class="${v === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <label class="ck"><input type="checkbox" id="dsafe" ${divState.safe ? "checked" : ""}> 관리·주의 종목 빼기</label></div>
  <div class="card"><h2>💰 ${k === "yld" ? "배당수익률" : "1주당 배당금"} 높은 순 <small>${list.length.toLocaleString("ko-KR")}종목</small></h2>${rows}
    ${list.length > divShow ? `<button class="more" id="dvmore">50개 더 보기</button>` : ""}
    <p class="muted small">배당수익률 = 1주당 배당금 ÷ 지금 주가 (${esc(D.date)} 종가 기준). 배당금은 가장 최근 사업보고서(1년 결산, 보통주) 기준이라 올해는 달라질 수 있어요.
    배당수익률이 유난히 높으면 주가가 크게 떨어졌거나 한 번만 준 특별 배당일 수 있어요. 1주당 배당금은 주가 수준이 회사마다 달라서 금액끼리 단순 비교는 어려워요.</p></div>${foot()}`;
}, "rank");

// ───────── 👔 임원·대주주 주식 변동 ─────────
let insState = Object.assign({ by: "buy", small: true }, store.get("ss-ins", {})), insShow = 50;
route(/^\/ins/, async () => {
  await loadIndex();
  let D;
  try { D = await DART("ins.json"); } catch { return `<div class="card"><h2>👔 임원·대주주 주식 변동</h2><p class="muted">자료를 준비하고 있어요. 잠시 뒤 다시 와 주세요.</p></div>${foot()}`; }
  let list = D.rows.filter((r) => BYCODE.has(r[0]));
  if (insState.small) list = list.filter((r) => r[8] == null || Math.abs(r[8]) >= 0.1);
  if (insState.by === "buy") list = list.filter((r) => r[5] > 0);
  else if (insState.by === "sell") list = list.filter((r) => r[5] < 0);
  else list = [...list].sort((a, b) => Math.abs(b[8] || 0) - Math.abs(a[8] || 0));
  after(() => {
    document.querySelectorAll("[data-iv]").forEach((b) => b.onclick = () => { insState.by = b.dataset.iv; store.set("ss-ins", insState); insShow = 50; render(); });
    $("#ismall").onchange = (e) => { insState.small = e.target.checked; store.set("ss-ins", insState); render(); };
    const m = $("#ivmore"); if (m) m.onclick = () => { insShow += 50; render(); };
  });
  return `<div class="toolbar"><div class="seg">${[["buy", "🔺 늘린 것"], ["sell", "🔻 줄인 것"], ["big", "💰 금액 큰 순"]].map(([v, l]) => `<button data-iv="${v}" class="${v === insState.by ? "on" : ""}">${l}</button>`).join("")}</div>
    <label class="ck"><input type="checkbox" id="ismall" ${insState.small ? "checked" : ""}> 1천만 원 미만 빼기</label></div>
  <div class="card"><h2>👔 임원·대주주 주식 변동 <small>최근 60일 · ${list.length.toLocaleString("ko-KR")}건</small></h2>
    ${list.slice(0, insShow).map((r) => insRow(r, r)).join("") || `<div class="muted small">해당하는 기록이 없어요.</div>`}
    ${list.length > insShow ? `<button class="more" id="ivmore">50개 더 보기</button>` : ""}
    <p class="muted small">회사 임원과 대주주(10% 이상 등)가 자기 회사 주식 수가 바뀌면 5일 안에 내는 보고(전자공시) 기준이에요. ${INS_NOTE} 회사 사정을 잘 아는 사람의 움직임이라 참고하는 사람이 많지만, 주가 방향을 보장하지는 않아요.</p></div>${foot()}`;
}, "rank");

// 실적 발표 일정 (달력·내 종목용): code → [날짜, 확정|예상, 설명, 이름]
async function erMap() {
  let m;
  try { m = await DART("ercal.json"); } catch { return null; }
  // 예상일이 주말·휴장일이면 다음 거래일로
  Object.values(m).forEach((v) => {
    const d = new Date(v[0] + "T00:00:00");
    for (let k = 0; k < 7 && !isOpen(d.getFullYear(), d.getMonth(), d.getDate()); k++) d.setDate(d.getDate() + 1);
    v[0] = isoOf(d.getFullYear(), d.getMonth(), d.getDate());
  });
  return m;
}
function myErHtml(ER, codes) {
  if (!ER) return "";
  const up = [...new Set(codes)].map((c) => [c, ER[c]]).filter(([, v]) => v && ddays(v[0]) >= 0 && ddays(v[0]) <= 30)
    .sort((a, b) => a[1][0].localeCompare(b[1][0]));
  if (!up.length) return "";
  return `<div class="card"><h2>📅 다가오는 실적 발표 <small>내 종목 · 30일 안</small></h2>
    ${up.map(([c, v]) => `<a class="row" href="#/s/${c}"><div class="nm"><b>${esc(v[3] || c)}</b><small>${dayTxt(v[0])} ${v[1] === "예상" ? "무렵 (작년 기준 예상)" : "(회사 발표)"}</small></div>
      <div class="rt"><b>${ddays(v[0]) === 0 ? "오늘" : "D-" + ddays(v[0])}</b></div></a>`).join("")}
    <p class="muted small">실적 발표 즈음엔 주가가 크게 움직일 수 있어요. <a href="#/cal">📅 달력에서 보기 ›</a></p></div>`;
}

// ───────── 🔥 오늘 이슈 (장중 20분마다 새로 고침) ─────────
const ISSUES = QS.get("issues") || "https://raw.githubusercontent.com/7415794-alt/stock-ai/live/issues.json";
async function loadIssues(force) {
  if (force) memo.delete(ISSUES);
  try { return await getJSON(ISSUES, 240000); } catch { return null; }
}
const issueChg = (s) => { const l = live(s[0]); return l && l[1] != null && LIVEJ && LIVEJ.t >= (ISS_T || "") ? l[1] : s[2]; };
let ISS_T = "";
function issueCard(x, full) {
  const st = x.state === "on" ? (x.dir > 0 ? `<span class="tag p">🔺 강세</span>` : `<span class="tag n">🔻 약세</span>`)
    : x.state === "wait" ? `<span class="tag z">⏳ 반응 확인 중</span>` : `<span class="tag z">🕗 장 전 뉴스</span>`;
  const title = x.named === false ? `${x.kw} 테마` : x.kw;
  const info = x.state === "on"
    ? `테마 종목 가운데값 <b class="${cls(x.med)}">${pctTxt(x.med, 1)}</b> · 시장보다 ${x.rel > 0 ? "+" : ""}${(x.rel ?? 0).toFixed(1)}%p · 같이 움직인 종목 ${x.nm}/${x.n}곳`
    : x.state === "wait" ? `장이 열렸지만 아직 반응이 약해요. 9시 40분까지 움직임이 없으면 내려요.`
      : `밤사이 뉴스 ${x.nh || 0}건${x.hint > 0 ? " · 호재 쪽" : x.hint < 0 ? " · 악재 쪽" : ""} · 장이 열리면 실제로 움직이는지 확인해요.`;
  const since = x.state === "on" ? `${esc(x.since)}부터${x.from_pre ? " · 장 전에 미리 알린 이슈" : ""}` : `${esc(x.since)} 올림`;
  const ths = `<p class="small muted" style="margin:8px 0 2px">🧩 테마</p><div class="chips">${x.themes.slice(0, full ? 8 : 4).map(([no, nm, med]) =>
    `<a class="chip" href="#/t/${no}">${esc(nm)}${med != null ? ` <span class="${cls(med)}">${pctTxt(med, 1)}</span>` : ""}</a>`).join("")}</div>`;
  const sts = `<p class="small muted" style="margin:8px 0 2px">${x.state === "on" ? "📈 많이 움직인 종목" : "📈 관련 종목"}</p><div class="chips">${x.stocks.slice(0, full ? 8 : 5).map((s) => {
    const c = issueChg(s);
    return `<a class="chip" href="#/s/${s[0]}">${esc(s[1])}${c != null ? ` <span class="${cls(c)}">${pctTxt(c, 1)}</span>` : ""}</a>`;
  }).join("")}</div>`;
  const nws = (x.news || []).slice(0, full ? 3 : 1).map((n) =>
    `<a href="${esc(n[1])}" target="_blank" rel="noopener">${esc(n[0])}<br><small>${esc(n[2])} · ${esc(n[3])}</small></a>`).join("");
  return `<div class="card" style="margin:0 0 10px"><h2 style="margin:0 0 4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-start">${st} ${esc(title)}
      <small class="muted" style="font-weight:400">${since}</small></h2>
    <p class="small" style="margin:0">${info}</p>${ths}${sts}${nws ? `<div class="news">${nws}</div>` : ""}</div>`;
}
const issueFresh = (I) => I && I.date === todayKST();

// 홈 화면용 작은 카드 (이슈가 있을 때만)
async function issueHome() {
  const I = await loadIssues();
  if (!issueFresh(I) || !I.items.length) return "";
  ISS_T = I.t;
  const on = I.items.filter((x) => x.state === "on");
  const xs = (on.length ? on : I.items).slice(0, 3);
  return `<a class="card" href="#/issues" style="display:block"><h2>🔥 오늘 시장 이슈 <small>${esc(I.t.slice(11))} 기준 ›</small></h2>
    ${xs.map((x) => `<div class="row" style="padding:6px 0"><div class="nm"><b>${x.state === "on" ? (x.dir > 0 ? "🔺" : "🔻") : "🕗"} ${esc(x.named === false ? x.kw + " 테마" : x.kw)}</b>
      <small>${esc(x.themes.slice(0, 3).map((t) => t[1].replace(/\(.*?\)/g, "")).join(" · "))}</small></div>
      <div class="rt">${x.state === "on" ? `<b class="${cls(x.med)}">${pctTxt(x.med, 1)}</b>` : `<small class="muted">장 전 뉴스</small>`}</div></div>`).join("")}</a>`;
}

route(/^\/issues/, async () => {
  view.innerHTML = `<div class="loading">오늘 이슈 불러오는 중…</div>`;
  const [I] = await Promise.all([loadIssues(), loadLive()]);
  const fresh = issueFresh(I);
  if (I) ISS_T = I.t;
  const items = I ? I.items : [];
  const on = items.filter((x) => x.state === "on"), pre = items.filter((x) => x.state !== "on");
  const phase = !I ? "" : !fresh ? `지난 거래일(${esc(I.date)}) 마지막 이슈예요. 오늘 이슈는 평일 오전 8시부터 나와요.`
    : I.phase === "pre" ? "장 시작 전이에요. 밤사이 뉴스로 고른 주목 이슈예요."
      : I.phase === "close" ? "오늘 장이 끝났어요. 마감 기준 이슈예요." : "장중이에요. 20분마다 새로 고쳐요.";
  const gone = fresh && I.gone && I.gone.length ? `<details class="card"><summary class="small muted">🧊 오늘 내려간 이슈 ${I.gone.length}개</summary>
    ${I.gone.slice().reverse().map((g) => `<p class="small" style="margin:6px 0">${esc(g.kw)} <span class="muted">· ${esc(g.since || "")}~${esc(g.until)} · ${esc(g.why)}</span></p>`).join("")}</details>` : "";
  return `<div class="card"><h2>🔥 오늘 시장 이슈 <small>${I ? esc(I.t.slice(5)) + " 기준" : ""}</small></h2>
    <p class="small" style="margin:0">${phase || "아직 이슈 자료가 없어요. 평일 오전 8시부터 만들어요."}</p></div>
  ${on.length ? on.map((x) => issueCard(x, true)).join("") : fresh && I.phase !== "pre" ? `<div class="card"><p class="small muted" style="margin:0">지금은 시장을 크게 움직이는 이슈가 없어요.</p></div>` : ""}
  ${pre.length ? `<h3 class="small muted" style="margin:14px 4px 6px">${fresh && I.phase === "pre" ? "🕗 장 전 주목 이슈" : "⏳ 아직 반응을 확인 중인 이슈"}</h3>${pre.map((x) => issueCard(x, true)).join("")}` : ""}
  ${gone}
  <div class="card"><p class="muted small" style="margin:0">어떻게 고르나요?<br>
    · <b>장 전(8시대)</b>: 밤사이 '관련주·수혜주·특징주' 뉴스에 많이 나온 테마를 먼저 올려요.<br>
    · <b>장중</b>: 테마 종목들의 가운데 등락률이 시장보다 2%p 넘게 움직이고, 10곳 중 4곳 넘게 3% 이상 같이 움직이면 새 이슈로 올려요. 이름은 그 종목들 뉴스 제목에 가장 많이 나온 말이에요.<br>
    · <b>내리는 기준</b>: 시장보다 1%p 미만으로 힘이 빠지거나, 장 전 이슈가 9시 40분까지 반응이 없으면 자동으로 내려요.<br>
    · 종목 등락률은 지금 가격이에요. 이슈는 투자 권유가 아니고, 테마 급등 뒤엔 급락도 잦아요.</p></div>${foot()}`;
}, "themes");

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
    const s = t.stocks.find((x) => x[4].includes(r) && !halt(BYCODE.get(x[0])));
    return s ? `<a class="role" href="#/s/${s[0]}"><span class="em">${ROLE[r][0]}</span><div style="flex:1;min-width:0"><b>${ROLE[r][1]} · ${esc(s[1])}</b>
      <div class="muted small">${esc(reason(r, s))}</div></div><span class="${cls(s[2])}">${pctTxt(s[2])}</span></a>` : "";
  }).join("");
  const stocks = t.stocks.filter((x) => !halt(BYCODE.get(x[0]))).sort((a, b) => (b[2] ?? -999) - (a[2] ?? -999));
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

  // 🩺 산 종목 점검: 본전·손절 참고선·확률 변화·위험 신호를 한 줄씩
  const dgHtml = await diagHtml(hs).catch(() => "");
  let checkHtml = "";
  if (hs.length) {
    const O = await DART("ovh.json").catch(() => null);
    const FEE = 0.00015, TAX = 0.002;
    const items = await Promise.all(hs.map(async ([c, name, price]) => {
      const s = BYCODE.get(c) || { code: c, name };
      const P = priceOf(s), now = P.now;
      if (now == null) return null;
      let p80 = null;
      try {
        const C = (await getJSON(`${DATA}s/${c}.json`)).chart.c, r1 = [];
        for (let i = Math.max(1, C.length - 120); i < C.length; i++) if (C[i - 1] > 0) r1.push(Math.abs(C[i] / C[i - 1] - 1) * 100);
        if (r1.length >= 40) p80 = qtl(r1, 0.8);
      } catch { /* 차트 없음 */ }
      const be = price * (1 + FEE) / (1 - FEE - TAX);        // 세금·수수료 넣은 본전
      const stop = p80 ? price * (1 - 2 * p80 / 100) : null;  // 산 가격 기준 손절 참고선
      const notes = [];
      let lv = 0; // 0 괜찮음 · 1 살펴보기 · 2 점검 필요
      if (now >= be) notes.push(`✅ 본전(${won(Math.round(be))}원) 위 · 세금·수수료 빼고 ${pctTxt((now * (1 - FEE - TAX) / (price * (1 + FEE)) - 1) * 100, 1)}`);
      else notes.push(`본전 ${won(Math.round(be))}원까지 <b>+${((be / now - 1) * 100).toFixed(1)}%</b>`);
      if (stop) {
        if (now <= stop) { lv = 2; notes.push(`✂️ <b class="down">손절 참고선 ${won(Math.round(stop))}원 아래</b> · 평소 흔들림을 넘어선 하락이에요`); }
        else if (now <= stop * 1.03) { lv = Math.max(lv, 1); notes.push(`✂️ 손절 참고선 ${won(Math.round(stop))}원 근처 (${((now / stop - 1) * 100).toFixed(1)}% 남음)`); }
        else notes.push(`✂️ 손절 참고선 ${won(Math.round(stop))}원까지 ${((now / stop - 1) * 100).toFixed(1)}% 여유`);
      }
      const a = s["p" + H], q = s["q" + H];
      if (a != null && q != null && a - q <= -0.08) { lv = Math.max(lv, 1); notes.push(`🤖 ${H}일 확률이 어제 ${Math.round(q * 100)}% → <b>${Math.round(a * 100)}%</b>로 크게 내렸어요`); }
      else if (a != null && q != null && a - q >= 0.08) notes.push(`🤖 ${H}일 확률이 어제 ${Math.round(q * 100)}% → <b>${Math.round(a * 100)}%</b>로 크게 올랐어요`);
      const rk = riskOf(s, O);
      if (rk.length) { lv = Math.max(lv, rk.some((x) => x[2]) ? 2 : 1); notes.push(rk.map((x) => x[0] + " " + x[1]).join(" · ")); }
      return { c, name, lv, notes };
    }));
    const list = items.filter(Boolean).sort((x, y) => y.lv - x.lv);
    const icon = ["🟢", "🟠", "🔴"];
    checkHtml = `<div class="card"><h2>🩺 산 종목 점검 <small>${list.filter((x) => x.lv).length ? `살펴볼 종목 ${list.filter((x) => x.lv).length}개` : "모두 평소 범위"}</small></h2>
      ${list.map((x) => `<a class="row" href="#/s/${x.c}" style="padding:7px 0"><div class="nm"><b>${icon[x.lv]} ${esc(x.name)}</b><small>${x.notes.join("<br>")}</small></div></a>`).join("")}
      <p class="muted small">본전 = 세금(0.20%)·수수료(0.015%)를 넣은 가격 · 손절 참고선 = 산 가격에서 그 종목 평소 흔들림(10번 중 8번)의 2배 아래.
      🔴 점검 필요 · 🟠 살펴보기 · 🟢 괜찮음. 사고팔라는 신호가 아니라 '다시 확인해 볼 때'를 알려 드려요. <a href="#/calc">🧮 계산기</a></p></div>`;
  }

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
  const [ERm, al, pc] = await Promise.all([erMap(), myAlerts().catch(() => []), pushCard().catch(() => "")]);
  const myEr = myErHtml(ERm, [...favs(), ...hs.map((x) => x[0])]);
  return `<div class="toolbar">${segH()}<span class="muted small">${esc(marketState())} ${esc(liveLabel())}</span></div>
  ${alertHtml(al, 30)}${myEr}<div class="card"><h2>⭐ 관심 종목 <small>${favs().length}개</small></h2>${favList(0, true)}</div>
  ${holdHtml}
  ${dgHtml}${checkHtml}
  ${tgtList()}
  <div class="card"><h2>🗳 AI vs 나</h2>${voteHtml}</div>
  ${pc}
  <p class="muted small">관심 종목·산 종목·찍은 기록은 이 휴대폰(브라우저)에만 저장돼요. 휴대폰 알림을 켜면 종목 코드만 알림 서버로 보내요.</p>${foot()}`;
}, "my");

// ───────── 🕰️ 닮은꼴 차트 ─────────
const SIMC = ["#e5484d", "#f59e0b", "#10b981", "#8b5cf6", "#06b6d4"];
function drawSim(cv, q, ms) {
  if (!cv) return;
  const css = getComputedStyle(document.documentElement);
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Hh = 220;
  cv.width = W * dpr; cv.height = Hh * dpr; cv.style.height = Hh + "px";
  const g = cv.getContext("2d"); g.scale(dpr, dpr);
  const all = [...q, ...ms.flatMap((m) => m[5])].filter((v) => v != null);
  const lo = Math.min(...all), hi = Math.max(...all), N = 40, pad = { l: 4, r: 40, t: 8, b: 18 };
  const x = (i) => pad.l + (W - pad.l - pad.r) * i / (N - 1), y = (v) => pad.t + (Hh - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1));
  g.font = "11px sans-serif"; g.fillStyle = css.getPropertyValue("--muted"); g.strokeStyle = css.getPropertyValue("--line");
  for (const v of [lo, 100, hi]) { g.beginPath(); g.moveTo(pad.l, y(v)); g.lineTo(W - pad.r, y(v)); g.stroke(); g.fillText(`${v >= 100 ? "+" : ""}${(v - 100).toFixed(0)}%`, W - pad.r + 4, y(v) + 4); }
  g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x(19), pad.t); g.lineTo(x(19), Hh - pad.b); g.stroke(); g.setLineDash([]);
  g.fillText("닮은 구간", x(0), Hh - 4); const t2 = "그 뒤 20일"; g.fillText(t2, x(39) - g.measureText(t2).width, Hh - 4);
  ms.forEach((m, k) => {
    g.strokeStyle = SIMC[k]; g.globalAlpha = 0.75; g.lineWidth = 1.5; g.beginPath();
    m[5].forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); g.stroke();
  });
  g.globalAlpha = 1; g.strokeStyle = css.getPropertyValue("--fg"); g.lineWidth = 3; g.beginPath();
  q.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); g.stroke();
}
async function simSection(code) {
  const box = $("#simbox");
  if (!box) return;
  let S;
  try { S = await getJSON(`${DATA}sim/${code}.json`, 3600000); } catch { return; }
  const ud = (r) => (r == null ? "-" : `<span class="${cls(r)}">${r > 0 ? "📈" : r < 0 ? "📉" : "➖"} ${pctTxt(r * 100, 1)}</span>`);
  const stat = ["1", "5", "20"].map((h) => {
    const [up, dn, n, med] = S.st[h];
    const rate = up / n, base = S.base[h];
    const tone = rate - base >= 0.1 ? "오른 쪽이 평소보다 많아요" : base - rate >= 0.1 ? "내린 쪽이 평소보다 많아요" : "평소와 비슷해요";
    return `<div class="stat"><small>${h}거래일 뒤</small><b class="${cls(rate - 0.5)}">${up}번 오름</b>
      <div class="small muted">${dn}번 내림 · 가운데 ${pctTxt(med * 100, 1)}<br>${tone}</div></div>`;
  }).join("");
  box.innerHTML = `<div class="card"><h2>🕰️ 닮은꼴 차트 <small>최근 20거래일 모양</small></h2>
    <p class="small" style="margin:0 0 6px">지금 이 종목과 가장 닮은 과거 장면을 전 종목 10년치에서 찾았어요. <b>굵은 선</b>이 지금, 색 선이 과거 장면과 그 뒤 20일이에요.</p>
    <canvas id="simcv"></canvas>
    <table style="margin-top:6px"><tr><th>닮은 장면</th><th class="r">1일 뒤</th><th class="r">5일 뒤</th><th class="r">20일 뒤</th></tr>
    ${S.m.map((m, k) => `<tr><td><span style="color:${SIMC[k]}">━</span> <a href="#/s/${m[0]}">${esc(m[1])}</a><br><small class="muted">${ymd(m[2])}~${ymd(m[3]).slice(3)} · 닮은 정도 ${Math.round(m[4] * 100)}%</small></td>
      <td class="r">${ud(m[6])}</td><td class="r">${ud(m[7])}</td><td class="r">${ud(m[8])}</td></tr>`).join("")}</table>
    <p class="small" style="margin:12px 0 4px"><b>닮은 장면 ${S.st["1"][2]}개는 그 뒤 어떻게 됐나</b></p>
    <div class="split">${stat}</div>
    <p class="muted small">평소(모든 과거 장면)에는 1·5·20거래일 뒤 오른 비율이 ${["1", "5", "20"].map((h) => Math.round(S.base[h] * 100) + "%").join("·")}예요. 이것보다 많이 높거나 낮아야 의미가 있어요.
      과거 모양이 닮았다고 똑같이 움직이는 건 아니에요. AI 확률과는 따로 계산한 참고 자료예요. (${esc(S.date)} 종가 기준)</p></div>`;
  drawSim($("#simcv"), S.q, S.m);
}

// ───────── 💣 물량 폭탄 경고 (전환사채·신주인수권·교환사채) ─────────
const OVK = { cb: ["전환사채", "전환가"], bw: ["신주인수권부사채", "행사가"], eb: ["교환사채", "교환가"] };
function ovhCalc(rows, now) {
  const today = todayKST();
  let open = 0, soon = 0;
  // 지금 가격이 전환가의 3배를 넘거나 비율이 100% 넘는 건 이미 주식으로 바뀌었거나(감자·병합 등) 비교가 어려운 자료라 뺌
  const odd = rows.filter((r) => (r[5] != null && r[5] > 100) || (now != null && now / r[2] > 3)).length;
  const items = rows.filter((r) => !((r[5] != null && r[5] > 100) || (now != null && now / r[2] > 3))).map((r) => {
    const [k, bd, price, floor, cnt, ratio, bgd, edd, rno] = r;
    const itm = now != null && now >= price, started = !bgd || bgd <= today;
    const dd = bgd ? ddays(bgd) : 0;
    if (itm && started) open += ratio || 0;
    else if (itm && dd <= 90) soon += ratio || 0;
    return { k, bd, price, floor, cnt, ratio, bgd, edd, rno, itm, started, dd, gap: now ? now / price - 1 : null };
  });
  return { items, open, soon, odd };
}
// ⚠️ 종목의 위험 신호: [아이콘, 설명, 심각(true/false)]
const ALERT_TXT = ["", "투자주의", "투자경고", "투자위험"];
function riskOf(s, O) {
  const out = [];
  if (halt(s)) out.push(["⛔", "거래정지", true]);
  if (s.managed) out.push(["🚨", "관리종목", true]);
  if (s.alert) out.push(["⚠️", ALERT_TXT[s.alert] || "투자주의", s.alert >= 2]);
  if (O && O.s && O.s[s.code]) {
    const o = ovhCalc(O.s[s.code], priceOf(s).now);
    if (o.open >= 10) out.push(["💣", `풀릴 수 있는 물량 최대 ${o.open.toFixed(0)}%`, true]);
    else if (o.open >= 3) out.push(["💣", `풀릴 수 있는 물량 최대 ${o.open.toFixed(1)}%`, false]);
  }
  return out;
}

// ───────── ⚠️ 위험 종목 모아 보기 ─────────
// ───────── 📰 크게 움직인 날, 왜? (공시·뉴스·테마·거래량을 그날에 맞춰 묶음) ─────────
let MOVEMAP = new Map(); // 차트에서 그날을 누르면 이유 한 줄
async function moveSection(d, TH) {
  const box = $("#movebox");
  MOVEMAP = new Map();
  if (!box || !d.chart || !d.chart.c) return;
  const { d: D, c: C, v: V } = d.chart, n = C.length;
  const rets = [];
  for (let i = Math.max(1, n - 120); i < n; i++) if (C[i - 1] > 0) rets.push(Math.abs(C[i] / C[i - 1] - 1) * 100);
  const lim = Math.max(5, qtl(rets, 0.9) || 0); // 그 종목 평소보다 크게 움직인 날 (최소 ±5%)
  const days = [];
  for (let i = n - 1; i >= Math.max(1, n - 60) && days.length < 5; i--) {
    const r = C[i - 1] > 0 ? (C[i] / C[i - 1] - 1) * 100 : 0;
    if (Math.abs(r) >= lim) days.push(i);
  }
  if (!days.length) { box.innerHTML = ""; return; }
  let X = null;
  try { X = await DART(`d/${d.code}.json`); } catch { /* 공시 없음 */ }
  if (!document.body.contains(box)) return;
  const iso = (k) => { const s = String(k).padStart(6, "0"); return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4)}`; };
  const rows = days.map((i) => {
    const r = (C[i] / C[i - 1] - 1) * 100, day = iso(D[i]), prev = iso(D[i - 1]);
    const vb = V && i >= 21 ? V.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20 : 0, vx = vb ? V[i] / vb : null;
    const why = [];
    // 공시: 그날 또는 전날 장 마감 뒤에 나온 것
    ((X && X.disc) || []).filter((x) => x[0] === day || (x[0] > prev && x[0] < day) || x[0] === prev).slice(0, 3)
      .forEach((x) => why.push(`📢 ${esc(x[1])} <small class="muted">${x[0].slice(5).replace("-", "/")} 공시</small>`));
    (d.news || []).filter((x) => x.w && x.w.slice(0, 10) === day).slice(0, 2)
      .forEach((x) => why.push(`📰 <a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t.length > 46 ? x.t.slice(0, 46) + "…" : x.t)}</a>`));
    if (i === n - 1 && TH && d.themes) {
      const same = d.themes.map((t) => TH.find((x) => String(x.no) === String(t[0]))).filter((t) => t && t.chg != null && Math.sign(t.chg) === Math.sign(r) && Math.abs(t.chg) >= 2)
        .sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg)).slice(0, 2);
      same.forEach((t) => why.push(`🧩 같은 테마 <a href="#/t/${t.no}">${esc(t.name)}</a> 평균 <span class="${cls(t.chg)}">${pctTxt(t.chg, 1)}</span>`));
    }
    if (vx && vx >= 3) why.push(`📊 거래량 평소의 <b>${vx.toFixed(1)}배</b>`);
    if (!why.length) why.push(`<span class="muted">이날 맞춰 볼 공시·뉴스가 없어요. 수급이나 시장 전체 흐름 때문일 수 있어요.</span>`);
    MOVEMAP.set(D[i], why.map((w) => w.replace(/<[^>]+>/g, "")).join(" · "));
    return `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="small"><b>${day.slice(5).replace("-", "/")}</b>
      <b class="${cls(r)}" style="margin-left:6px">${pctTxt(r, 1)}</b>${vx ? ` <small class="muted">거래량 ${vx.toFixed(1)}배</small>` : ""}</div>
      <div class="small" style="line-height:1.8">${why.join("<br>")}</div></div>`;
  });
  box.innerHTML = `<div class="card"><h2>📰 크게 움직인 날, 왜? <small>최근 3개월 · ±${lim.toFixed(0)}% 넘게</small></h2>${rows.join("")}
    <p class="muted small">그날(또는 전날 장 마감 뒤) 나온 공시, 그날 뉴스, 같은 테마 흐름, 거래량을 맞춰 봤어요. 위 차트에서 그 날짜를 눌러도 보여요. 꼭 그 이유 때문이라는 뜻은 아니에요.</p></div>`;
}

// ───────── 📊 실적 한 줄 요약 ─────────
function qLine(Q) {
  if (!Q || Q.length < 2) return "";
  const L = Q[Q.length - 1], Y = Q.length >= 5 ? Q[Q.length - 5] : null, P = Q[Q.length - 2];
  const yy = (a, b) => (b == null || a == null ? null : b > 0 ? (a / b - 1) * 100 : null);
  const amt = (v) => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "조" : Math.round(v).toLocaleString("ko-KR") + "억");
  const op = L[2], opY = Y ? Y[2] : null;
  let st;
  if (opY != null && opY <= 0 && op > 0) st = `<b class="up">흑자 전환</b>`;
  else if (opY != null && opY > 0 && op <= 0) st = `<b class="down">적자 전환</b>`;
  else if (op <= 0) st = `<b class="down">적자 이어짐</b>`;
  else { const g = yy(op, opY); st = g == null ? "" : `작년 같은 분기보다 <b class="${cls(g)}">${pctTxt(g, 0)}</b>`; }
  const gs = yy(L[1], Y ? Y[1] : null), gq = yy(op, P[2]);
  return `<p class="small" style="margin:0 0 8px;padding:8px 10px;background:var(--soft);border-radius:10px">📌 <b>${esc(L[0])}</b> 영업이익 <b>${amt(op)}원</b> · ${st}
    ${gs != null ? `<br>매출 ${amt(L[1])}원 (작년 같은 분기보다 <span class="${cls(gs)}">${pctTxt(gs, 0)}</span>)` : ""}${gq != null && P[2] > 0 && op > 0 ? ` · 바로 전 분기보다 영업이익 <span class="${cls(gq)}">${pctTxt(gq, 0)}</span>` : ""}</p>`;
}

// ───────── 🖼 공유 카드 이미지 ─────────
async function shareImg(d, P, pr) {
  const W = 1080, Hh = 1350, cv = document.createElement("canvas");
  cv.width = W; cv.height = Hh;
  const g = cv.getContext("2d"), F = '"Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  const bg = g.createLinearGradient(0, 0, 0, Hh); bg.addColorStop(0, "#1f2a5c"); bg.addColorStop(1, "#11151f");
  g.fillStyle = bg; g.fillRect(0, 0, W, Hh);
  const txt = (t, x, y, size, color = "#fff", weight = "700", align = "left") => { g.font = `${weight} ${size}px ${F}`; g.fillStyle = color; g.textAlign = align; g.fillText(t, x, y); };
  txt("📈 스톡시그널", 80, 130, 44, "#9aabff");
  txt(d.name, 80, 270, 84);
  txt(`${d.code} · ${d.market === "KOSPI" ? "코스피" : "코스닥"}`, 80, 340, 38, "#b3bac8", "400");
  txt(`${won(pr.now)}원  ${pctTxt(pr.chg)}`, 80, 420, 46, pr.chg > 0 ? "#ff6b70" : pr.chg < 0 ? "#6fa0ff" : "#fff", "700");
  g.fillStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.roundRect ? g.roundRect(60, 500, W - 120, 470, 40) : g.rect(60, 500, W - 120, 470); g.fill();
  txt(`${H}거래일 뒤 AI 상승 확률`, W / 2, 600, 44, "#e9ecf2", "400", "center");
  const p = Math.round(P.p * 100);
  txt(`${p}%`, W / 2, 800, 220, p >= 50 ? "#ff6b70" : "#6fa0ff", "800", "center");
  const st = d.stat && d.stat[String(H)];
  if (st && st.n) txt(`이 종목 최근 ${st.n}번 예측 중 ${st.hits}번 맞힘 (${Math.round(st.hits / st.n * 100)}%)`, W / 2, 900, 36, "#b3bac8", "400", "center");
  txt(`AI 기준일 ${d.date}`, 80, 1080, 34, "#b3bac8", "400");
  txt("과거 자료로 계산한 참고용 확률이며 투자 권유가 아닙니다.", 80, 1140, 30, "#8a93a6", "400");
  txt("stocksignals.kr", W - 80, 1270, 40, "#9aabff", "700", "right");
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const file = new File([blob], `stocksignals_${d.code}.png`, { type: "image/png" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "스톡시그널", text: `${d.name} ${H}일 뒤 AI 상승 확률 ${p}%` }); return; }
  } catch { return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("이미지를 저장했어요");
}

// ───────── 🩺 내 계좌 종합 진단 ─────────
async function diagHtml(hs) {
  if (!hs.length) return "";
  const items = (await Promise.all(hs.map(async ([c, name, price, qty]) => {
    const s = BYCODE.get(c), now = s ? priceOf(s).now : null;
    if (!now || !(qty > 0)) return null;
    let themes = [];
    try { themes = (await getJSON(`${DATA}s/${c}.json`)).themes || []; } catch { /* 없음 */ }
    return { c, name: s ? s.name : name, cost: price * qty, val: now * qty, p: s ? s["p" + H] : null, mkt: s ? s.market : "", themes, risk: s ? riskOf(s, null).length : 0 };
  }))).filter(Boolean);
  if (!items.length) return "";
  const tot = items.reduce((a, x) => a + x.val, 0), cost = items.reduce((a, x) => a + x.cost, 0);
  const net = tot * (1 - 0.00015 - 0.002) - cost * 1.00015, pnl = net / cost * 100;
  const top = [...items].sort((a, b) => b.val - a.val)[0], tw = top.val / tot * 100;
  const kq = items.filter((x) => x.mkt === "KOSDAQ").reduce((a, x) => a + x.val, 0) / tot * 100;
  const tm = new Map();
  const TH = await getJSON(DATA + "themes.json", 3600000).catch(() => null);
  const size = new Map((TH || []).map((t) => [String(t.no), t.stocks.length]));
  items.forEach((x) => x.themes.filter(([no, nm]) => (size.get(String(no)) || 999) <= 60 && !/지수|밸류업/.test(nm)).forEach(([no, nm]) => { const o = tm.get(no) || { nm, w: 0, n: 0 }; o.w += x.val / tot * 100; o.n++; tm.set(no, o); }));
  const bigT = [...tm.values()].filter((t) => t.n >= 2).sort((a, b) => b.w - a.w)[0];
  const ps = items.filter((x) => x.p != null), avgP = ps.length ? ps.reduce((a, x) => a + x.p * x.val, 0) / ps.reduce((a, x) => a + x.val, 0) : null;
  const risky = items.filter((x) => x.risk).length;
  const line = (ok, t) => `<div class="small" style="margin:5px 0">${ok === 2 ? "🔴" : ok === 1 ? "🟠" : "🟢"} ${t}</div>`;
  const L = [];
  L.push(line(items.length === 1 ? 2 : tw >= 40 ? 1 : 0, items.length === 1 ? `종목이 <b>1개</b>뿐이에요. 그 종목 하나에 결과가 모두 달려 있어요.` : `가장 큰 종목은 <b>${esc(top.name)}</b> (<b>${tw.toFixed(0)}%</b>)${tw >= 40 ? " — 한 종목 쏠림이 커요" : " — 고르게 나뉘어 있어요"}`));
  if (bigT) L.push(line(bigT.w >= 60 ? 1 : 0, `같은 테마 <b>${esc(bigT.nm)}</b>에 ${bigT.n}종목 · 합쳐서 ${bigT.w.toFixed(0)}%${bigT.w >= 60 ? " — 같은 소식에 함께 움직일 수 있어요" : ""}`));
  L.push(line(kq >= 70 ? 1 : 0, `코스닥 ${kq.toFixed(0)}% · 코스피 ${(100 - kq).toFixed(0)}%${kq >= 70 ? " — 코스닥은 더 크게 흔들려요" : ""}`));
  if (avgP != null) L.push(line(avgP < 0.45 ? 1 : 0, `내 종목 ${H}일 뒤 평균 상승 확률 <b>${Math.round(avgP * 100)}%</b> (금액 비중으로 평균, 전 종목 평균과 비교해 보세요)`));
  L.push(line(risky ? 2 : 0, risky ? `위험 신호(거래정지·관리종목·투자주의/경고)가 있는 종목 <b>${risky}개</b>` : `위험 신호가 있는 종목은 없어요`));
  return `<div class="card"><h2>🩺 내 계좌 종합 진단 <small>${items.length}종목</small></h2>
    <div class="split"><div class="stat"><small>평가 금액</small><b>${won(Math.round(tot))}원</b></div>
      <div class="stat"><small>세금·수수료 빼고</small><b class="${cls(pnl)}">${pctTxt(pnl, 1)}</b><div class="small muted">${net >= 0 ? "+" : ""}${won(Math.round(net))}원</div></div></div>
    ${L.join("")}
    <p class="muted small">사고팔라는 뜻이 아니라 지금 상태를 사실대로 보여 드려요. 이 계산은 이 휴대폰 안에서만 해요.</p></div>`;
}

// ───────── 🎮 가상 계좌 1,000만 원 ─────────
const PAPER0 = 10000000, P_FEE = 0.00015, P_TAX = 0.002;
const paper = () => store.get("ss-paper", null);
function kospiNow() { const v = LIVEJ && LIVEJ.idx && LIVEJ.idx.KOSPI; return v ? v[0] : null; }
function paperStart() {
  const ok = INDEX.filter((s) => s["p" + H] != null && !s.managed && !s.alert && !halt(s) && priceOf(s).now);
  const top = [...ok].sort((a, b) => b["p" + H] - a["p" + H]).slice(0, 5).map((s) => [s.code, s.name, priceOf(s).now]);
  const st = { start: todayKST(), h: H, cash: PAPER0, pos: {}, log: [], bench: top, kospi: kospiNow() };
  store.set("ss-paper", st);
  return st;
}
route(/^\/paper(?:\?([0-9A-Z]{6}))?/, async (code) => {
  await Promise.all([loadIndex(), loadLive()]);
  let st = paper();
  if (!st) {
    after(() => { $("#pstart").onclick = () => { paperStart(); toast("🎮 가상 계좌를 열었어요"); render(); }; });
    return `<div class="card"><h2>🎮 가상 계좌 1,000만 원</h2>
      <p class="small">진짜 돈 없이 <b>가상의 1,000만 원</b>으로 사고팔아 보는 연습장이에요. 지금 가격에 사고팔고, 세금·수수료도 실제처럼 빼요.</p>
      <p class="small">시작하는 순간의 <b>AI ${H}일 상승 확률 상위 5종목</b>을 똑같이 나눠 샀다고 치고, 내 실력과 계속 비교해 드려요. 코스피와도 비교해요.</p>
      <button class="more" id="pstart">🎮 가상 계좌 열기</button>
      <p class="muted small">기록은 이 휴대폰에만 저장돼요.</p></div>${foot()}`;
  }
  const nowOf = (c) => { const s = BYCODE.get(c); return s ? priceOf(s).now : null; };
  const posRows = Object.entries(st.pos).map(([c, [q, avg, nm]]) => {
    const now = nowOf(c) || avg, val = now * q, r = (now * (1 - P_FEE - P_TAX) / (avg * (1 + P_FEE)) - 1) * 100;
    return { c, q, avg, nm, now, val, r };
  });
  const tot = st.cash + posRows.reduce((a, x) => a + x.val, 0), myR = (tot / PAPER0 - 1) * 100;
  const bR = st.bench.length ? st.bench.reduce((a, [c, , p0]) => a + ((nowOf(c) || p0) / p0 - 1), 0) / st.bench.length * 100 - (P_FEE * 2 + P_TAX) * 100 : null;
  const kN = kospiNow(), kR = st.kospi && kN ? (kN / st.kospi - 1) * 100 : null;
  const pick = code ? BYCODE.get(code) : null;
  after(() => {
    const doBuy = () => {
      const s = pick || searchList($("#pq").value, 1)[0];
      if (!s) return toast("종목을 못 찾았어요");
      const now = priceOf(s).now;
      if (!now || halt(s)) return toast("지금은 살 수 없는 종목이에요");
      let q = Math.floor(+$("#pn").value);
      const amt = +$("#pa").value;
      if (!(q > 0) && amt > 0) q = Math.floor(amt / (now * (1 + P_FEE)));
      if (!(q > 0)) return toast("수량이나 금액을 넣어 주세요");
      const cost = now * q * (1 + P_FEE);
      if (cost > st.cash) return toast(`가상 현금이 모자라요 (최대 ${Math.floor(st.cash / (now * (1 + P_FEE)))}주)`);
      const o = st.pos[s.code] || [0, 0, s.name];
      const q2 = o[0] + q;
      st.pos[s.code] = [q2, (o[0] * o[1] + q * now) / q2, s.name];
      st.cash -= cost;
      st.log.unshift([todayKST(), s.code, s.name, "B", q, now]);
      st.log = st.log.slice(0, 100);
      store.set("ss-paper", st); toast(`🎮 ${s.name} ${q}주를 가상으로 샀어요`); location.hash = "#/paper";
      render();
    };
    $("#pbuy").onclick = doBuy;
    document.querySelectorAll("[data-psell]").forEach((b) => b.onclick = () => {
      const c = b.dataset.psell, [q, , nm] = st.pos[c], now = nowOf(c);
      if (!now) return toast("지금 가격을 몰라요");
      const n = Math.floor(+prompt(`${nm} 몇 주 팔까요? (최대 ${q}주)`, q));
      if (!(n > 0)) return;
      const k = Math.min(n, q);
      st.cash += now * k * (1 - P_FEE - P_TAX);
      if (k >= q) delete st.pos[c]; else st.pos[c][0] = q - k;
      st.log.unshift([todayKST(), c, nm, "S", k, now]);
      store.set("ss-paper", st); toast(`${nm} ${k}주를 가상으로 팔았어요`); render();
    });
    if (lbMe() && st.log.length) lbSend();
    $("#preset").onclick = () => { if (confirm("가상 계좌를 처음부터 다시 시작할까요? 지금 기록은 지워져요.")) { store.set("ss-paper", null); render(); } };
  });
  const cmp = (t, v, sub) => `<div class="stat"><small>${t}</small><b class="${cls(v)}">${v == null ? "-" : pctTxt(v, 1)}</b><div class="small muted">${sub}</div></div>`;
  return `<div class="card"><h2>🎮 가상 계좌 <small>${esc(st.start)}부터</small></h2>
    <div class="split"><div class="stat"><small>총 자산</small><b>${won(Math.round(tot))}원</b><div class="small muted">현금 ${won(Math.round(st.cash))}원</div></div>
      ${cmp("내 수익률", myR, "세금·수수료 뺌")}</div>
    <div class="split" style="margin-top:6px">${cmp(`AI 상위 5 (${st.h}일 확률)`, bR, "시작할 때 똑같이 샀다면")}${cmp("코스피", kR, "같은 기간 지수")}</div>
    <p class="small" style="margin:8px 0 0">${bR == null || !st.log.length ? "" : myR >= bR ? "👏 지금은 <b>내가 AI보다 앞서요!</b>" : "🤖 지금은 <b>AI가 앞서요.</b>"}</p></div>
  <div class="card"><h2>🛒 가상으로 사기</h2>
    ${pick ? `<p class="small" style="margin:0 0 6px"><b>${esc(pick.name)}</b> · 지금 ${won(priceOf(pick).now)}원</p>` : `<input id="pq" class="num" placeholder="종목 이름이나 코드">`}
    <div class="split" style="margin-top:6px"><input id="pn" class="num" type="number" inputmode="numeric" placeholder="수량 (주)"><input id="pa" class="num" type="number" inputmode="numeric" placeholder="또는 금액 (원)"></div>
    <button class="more" id="pbuy" style="margin-top:6px">사기</button>
    <p class="muted small">지금 가격(장 마감 뒤엔 종가)으로 바로 체결돼요. 살 때 수수료 0.015%, 팔 때 수수료+세금 0.215%를 빼요.</p></div>
  <div class="card"><h2>📦 가진 종목 <small>${posRows.length}개</small></h2>
    ${posRows.length ? posRows.map((x) => `<div class="row" style="padding:6px 0"><a class="nm" href="#/s/${x.c}"><b>${esc(x.nm)}</b><small>${x.q}주 · 평균 ${won(Math.round(x.avg))}원 → 지금 ${won(x.now)}원</small></a>
      <div class="rt"><b class="${cls(x.r)}">${pctTxt(x.r, 1)}</b><br><button class="icon-btn" data-psell="${x.c}">팔기</button></div></div>`).join("") : `<p class="muted small">아직 산 종목이 없어요.</p>`}</div>
  <details class="card"><summary><b>🤖 비교 대상: 시작할 때 AI 상위 5종목</b></summary>${st.bench.map(([c, nm, p0]) => { const now = nowOf(c) || p0; return `<a class="row" href="#/s/${c}" style="padding:4px 0"><div class="nm"><b>${esc(nm)}</b><small>${won(p0)}원 → ${won(now)}원</small></div><span class="${cls(now / p0 - 1)}">${pctTxt((now / p0 - 1) * 100, 1)}</span></a>`; }).join("")}</details>
  ${st.log.length ? `<details class="card"><summary><b>🧾 거래 기록</b> <small class="muted">${st.log.length}건</small></summary><table><tr><th>날짜</th><th>종목</th><th class="r">수량·가격</th></tr>
    ${st.log.map(([dt, c, nm, sd, q, p]) => `<tr><td>${dt.slice(5)}</td><td>${sd === "B" ? "🔴 사기" : "🔵 팔기"} ${esc(nm)}</td><td class="r">${q}주 · ${won(p)}</td></tr>`).join("")}</table></details>` : ""}
  <a class="card" href="#/league" style="display:block"><h2 style="margin:0">🏆 모의투자 랭킹 <small>${lbMe() ? `'${esc(lbMe().nick)}'로 참가 중 ›` : "AI 계좌·다른 사람과 겨루기 ›"}</small></h2></a>
  <div class="card"><button class="more" id="preset">🔄 처음부터 다시</button><p class="muted small">연습용 가상 거래예요. 실제 주문이 나가지 않아요.</p></div>${foot()}`;
}, "my");

// ───────── 🏆 신고가·신저가·거래 급증 ─────────
let hotTab = store.get("ss-hot", "hi");
route(/^\/hot/, async () => {
  await Promise.all([loadIndex(), loadLive()]);
  let J;
  try { J = await getJSON(DATA + "hot.json", 3600000); } catch { return `<div class="card">아직 자료가 없어요. 오후 5시 계산 뒤에 생겨요.</div>${foot()}`; }
  const tabs = [["hi", "🏆 52주 신고가"], ["vol", "📊 거래 급증"], ["lo", "📉 52주 신저가"]];
  after(() => document.querySelectorAll("[data-hot]").forEach((b) => b.onclick = () => { hotTab = b.dataset.hot; store.set("ss-hot", hotTab); render(); }));
  const L = (J[hotTab] || []).filter((r) => !halt(BYCODE.get(r[0])));
  const sub = (r) => hotTab === "vol" ? `거래량 평소의 <b>${r[4]}배</b> · 거래대금 ${won(r[5])}억` : hotTab === "hi" ? `1년 최고가 ${won(r[4])}원을 넘었어요` : `1년 최저가 ${won(r[4])}원 아래로`;
  return `<div class="card"><h2>🚀 신고가·거래 급증 <small>${esc(J.date || "")} 종가 기준</small></h2>
    <div class="seg" style="flex-wrap:wrap">${tabs.map(([k, l]) => `<button class="${hotTab === k ? "on" : ""}" data-hot="${k}">${l} ${(J[k] || []).length}</button>`).join("")}</div></div>
  <div class="card">${L.length ? L.map((r) => { const s = BYCODE.get(r[0]), p = s && s["p" + H]; return `<a class="row" href="#/s/${r[0]}" style="padding:6px 0"><div class="nm"><b>${esc(r[1])}</b><small>${sub(r)}${p != null ? ` · AI ${H}일 ${Math.round(p * 100)}%` : ""}</small></div>
      <div class="rt">${won(r[2])}<br><span class="${cls(r[3])}">${pctTxt((r[3] || 0) * 100, 1)}</span></div></a>`; }).join("") : `<p class="muted small">오늘은 해당하는 종목이 없어요.</p>`}</div>
  <div class="card"><p class="muted small" style="margin:0">🏆 52주 신고가: 오늘 장중 최고가가 지난 1년 최고가 이상이고 오른 종목 · 📉 신저가: 반대 · 📊 거래 급증: 거래량이 최근 20일 평균의 3배 넘고 거래대금 10억 원 이상.
    관리종목은 뺐어요. 신고가는 위에 팔려는 물량이 적어 더 오르기도 하지만, 많이 오른 만큼 크게 흔들릴 수도 있어요.</p></div>${foot()}`;
}, "rank");

// ───────── 👋 처음 쓰는 사람 안내 ─────────
const INTRO = [
  ["📈", "AI 상승 확률이란?", "AI가 지난 10년 비슷한 상황 뒤에 주가가 실제로 오른 비율을 배워서, 1·5·20일 뒤 지금보다 오를 확률을 계산해요. 50%가 넘으면 '오를 가능성이 더 크다'는 뜻이에요. 확실한 미래는 아니에요."],
  ["🎯", "적중률을 꼭 같이 보세요", "종목마다 AI가 과거에 몇 번 맞혔는지 그대로 공개해요. 잘 맞히던 종목의 확률이 더 믿을 만해요. 'AI 성적표'에서 매일 채점 결과도 볼 수 있어요."],
  ["⭐", "내 종목을 담고 알림을 켜세요", "종목 화면의 ☆를 누르면 내 종목에 담겨요. 산 가격을 넣으면 본전·손절 참고선을 계산해 드리고, 알림을 켜면 급등락·목표가·공시를 휴대폰으로 알려 드려요."],
];
function showIntro(i = 0) {
  let el = document.getElementById("intro");
  if (!el) {
    el = document.createElement("div"); el.id = "intro";
    el.style.cssText = "position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";
    document.body.appendChild(el);
    document.body.style.overflow = "hidden";
  }
  const [e, t, d] = INTRO[i], last = i === INTRO.length - 1;
  el.innerHTML = `<div class="card" style="max-width:420px;width:100%;margin:0;text-align:center">
    <div style="font-size:52px;line-height:1.2">${e}</div><h2 style="justify-content:center">${t}</h2><p class="small" style="text-align:left">${d}</p>
    <div style="margin:10px 0">${INTRO.map((_, k) => `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;margin:0 3px;background:${k === i ? "var(--accent)" : "var(--line)"}"></span>`).join("")}</div>
    <div class="split"><button class="more" id="ix-skip">${last ? "닫기" : "건너뛰기"}</button><button class="more" id="ix-next" style="background:var(--accent);color:var(--bg)">${last ? "시작하기" : "다음"}</button></div></div>`;
  const close = () => { store.set("ss-intro", 1); el.remove(); document.body.style.overflow = ""; };
  el.querySelector("#ix-skip").onclick = close;
  el.querySelector("#ix-next").onclick = () => (last ? close() : showIntro(i + 1));
}

// ───────── 🗞️ 주간 리포트 (금요일 저녁 알림에서 열림) ─────────
route(/^\/week/, async () => {
  await Promise.all([loadIndex(), loadLive()]);
  const today = todayKST(), wk = new Date(Date.now() + 9 * 3600e3 - 7 * 864e5).toISOString().slice(0, 10);
  const [card, B, ER] = await Promise.all([getJSON(DATA + "scorecard.json", 3600000).catch(() => []),
    getJSON(DATA + "bots.json", 600000).catch(() => null), erMap()]);
  // ① 이번 주 AI 성적
  const w = (card || []).filter((r) => r.eval_date > wk);
  const sum = (k) => w.reduce((a, x) => a + (x[k] || 0), 0);
  const pc = (a, b) => (b ? Math.round(a / b * 100) : null);
  const aiHtml = w.length ? `<div class="split">
      <div class="stat"><small>전 종목 적중률</small><b>${pc(sum("all_hit"), sum("all_n")) ?? "-"}%</b><div class="small muted">${w.length}거래일 합계</div></div>
      <div class="stat"><small>📈 상승 TOP 20</small><b>${pc(sum("up_hit"), sum("up_n"))}%</b><div class="small muted">실제로 오른 비율</div></div>
      <div class="stat"><small>전체 종목 (비교용)</small><b>${Math.round(sum("all_up") / w.length * 100)}%</b><div class="small muted">하루 평균 오른 비율</div></div></div>
      <table style="margin-top:6px"><tr><th>결과일</th><th class="r">전 종목</th><th class="r">상승 TOP 20</th><th class="r">전체 상승</th></tr>
      ${[...w].reverse().map((x) => `<tr><td>${mdOf(x.eval_date)}</td><td class="r">${x.all_n ? pc(x.all_hit, x.all_n) + "%" : "-"}</td><td class="r">${x.up_hit}/${x.up_n}</td><td class="r">${Math.round(x.all_up * 100)}%</td></tr>`).join("")}</table>`
    : `<p class="muted small">이번 주 채점 기록이 아직 없어요.</p>`;
  // ② 내 종목 한 주
  const fs = favs().slice(0, 20);
  const wkRows = (await Promise.all(fs.map(async (c) => {
    try {
      const d = await getJSON(`${DATA}s/${c}.json`, 3600000), C = d.chart.c, s = BYCODE.get(c);
      const lim = yymmdd(wk), D = d.chart.d;
      let i = D.length - 1;
      while (i > 0 && D[i] > lim) i--; // 일주일 전(그날 또는 그 전 거래일) 종가
      const now = s ? priceOf(s).now : C[C.length - 1], base = D[i] <= lim ? C[i] : null;
      return base ? [c, d.name, now / base - 1, s ? s["p" + H] : null] : null;
    } catch { return null; }
  }))).filter(Boolean).sort((a, b) => b[2] - a[2]);
  const myHtml = !fs.length ? `<p class="muted small">관심 종목이 없어요. 종목 화면 ☆를 누르면 여기서 한 주 변화를 볼 수 있어요.</p>`
    : wkRows.map(([c, nm, r, p]) => `<a class="row" href="#/s/${c}"><div class="nm"><b>${esc(nm)}</b><small>${p != null ? `🤖 ${H}일 뒤 상승 확률 ${Math.round(p * 100)}%` : ""}</small></div>
      <div class="rt"><b class="${cls(r)}">${pctTxt(r * 100, 1)}</b></div></a>`).join("");
  // ③ 모의투자
  const st = paper();
  let myR = null;
  if (st) {
    const tot = st.cash + Object.entries(st.pos).reduce((a, [c, [q, avg]]) => { const s = BYCODE.get(c); return a + (s ? priceOf(s).now : avg) * q; }, 0);
    myR = tot / PAPER0 - 1;
  }
  const bots = B && B.bots ? Object.values(B.bots).sort((a, b) => b.ret - a.ret) : [];
  const pvHtml = `${st ? `<div class="row"><div class="nm"><b>🎮 내 가상 계좌</b><small>${esc(st.start)}부터</small></div><div class="rt"><b class="${cls(myR)}">${pctTxt(myR * 100, 1)}</b></div></div>` : ""}
    ${bots.map((b) => `<div class="row"><div class="nm"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div><div class="rt"><b class="${cls(b.ret)}">${pctTxt(b.ret * 100, 1)}</b></div></div>`).join("")}
    ${!st && !bots.length ? `<p class="muted small">아직 기록이 없어요.</p>` : ""}`;
  // ④ 다음 7일 일정
  const ev = [];
  for (let k = 1; k <= 7; k++) {
    const dt = new Date(Date.now() + 9 * 3600e3 + k * 864e5), iso = dt.toISOString().slice(0, 10);
    const E = monthEvents(dt.getUTCFullYear(), dt.getUTCMonth())[iso] || [];
    E.filter((e) => e.k !== "low").forEach((e) => ev.push([iso, e.t]));
    if (ER) favs().forEach((c) => { const v = ER[c]; if (v && v[0] === iso) ev.push([iso, `${v[3] || c} 실적 발표${v[1] === "예상" ? " (예상)" : ""}`]); });
  }
  const evHtml = ev.length ? ev.map(([iso, t]) => `<div class="row"><div class="nm"><b>${esc(t)}</b><small>${dayTxt(iso)}</small></div></div>`).join("")
    : `<p class="muted small">다음 7일 동안 큰 일정이 없어요.</p>`;
  return `<div class="card"><h2>🗞️ 주간 리포트 <small>${mdOf(wk)} ~ ${mdOf(today)}</small></h2><p class="small" style="margin:0">한 주 동안 AI 성적, 내 종목, 모의투자를 한 번에 정리했어요. 금요일 저녁 알림에서도 열 수 있어요.</p></div>
    <div class="card"><h2>📋 이번 주 AI 성적</h2>${aiHtml}<p class="muted small">'1거래일 뒤' 확률로 매일 채점한 결과를 모았어요. <a href="#/score">자세히 ›</a></p></div>
    <div class="card"><h2>⭐ 내 종목 한 주 <small>일주일 전 종가보다</small></h2>${myHtml}</div>
    <div class="card"><h2>🏆 모의투자 <small><a href="#/league">랭킹 ›</a></small></h2>${pvHtml}</div>
    <div class="card"><h2>📅 다음 7일 일정</h2>${evHtml}<p class="muted small"><a href="#/cal">📅 달력에서 보기 ›</a></p></div>${foot()}`;
}, "my");

// ───────── 🏆 모의투자 랭킹 (사람 + AI 모의투자 계좌) ─────────
const lbMe = () => store.get("ss-lb", null); // {id, nick} — 랭킹에 올리기로 한 경우만
const lbId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function lbSend(force) {
  const me = lbMe(), st = paper();
  if (!me || !st || !st.log.length) return null;
  const nowOf = (c) => { const s = BYCODE.get(c); return s ? priceOf(s).now : null; };
  const tot = st.cash + Object.entries(st.pos).reduce((a, [c, [q, avg]]) => a + (nowOf(c) || avg) * q, 0);
  const ret = Math.round((tot / PAPER0 - 1) * 10000) / 10000;
  const sig = JSON.stringify([ret, st.start, st.log.length, me.nick, todayKST()]);
  if (!force && store.get("ss-lb-sig", "") === sig) return store.get("ss-lb-last", null);
  try {
    const r = await (await fetch(PUSH_URL + "/lb", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: me.id, nick: me.nick, ret, start: st.start, trades: st.log.length }) })).json();
    if (r.ok) { store.set("ss-lb-sig", sig); store.set("ss-lb-last", r); store.set("ss-lb-h", r.h); }
    return r;
  } catch { return null; }
}
const ymdBot = (s) => (s && s.length === 6 ? `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4)}` : s || "");
route(/^\/league/, async () => {
  await Promise.all([loadIndex(), loadLive()]);
  const [B, L, SG] = await Promise.all([getJSON(DATA + "bots.json", 600000).catch(() => null),
    fetch(PUSH_URL + "/lb").then((r) => r.json()).catch(() => ({ rows: [] })), getJSON(DATA + "strategy.json", 3600000).catch(() => null)]);
  const st = paper(), me = lbMe();
  if (me && st && st.log.length) await lbSend();
  const myH = store.get("ss-lb-h", "");
  const rows = (L.rows || []);
  after(() => {
    const j = $("#lbjoin");
    if (j) j.onclick = async () => {
      const nick = ($("#lbnick").value || "").trim();
      if (nick.length < 2 || nick.length > 12) return toast("이름은 2~12글자로 정해 주세요");
      store.set("ss-lb", { id: (me && me.id) || lbId(), nick });
      const r = await lbSend(true);
      toast(r && r.ok ? `🏆 랭킹에 올렸어요 (${r.rank}위)` : r && r.why === "nick" ? "쓸 수 없는 이름이에요" : "랭킹 서버에 연결하지 못했어요");
      render();
    };
    const q = $("#lbquit");
    if (q) q.onclick = async () => {
      try { await fetch(PUSH_URL + "/lbdel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: me.id }) }); } catch { /* 30일 뒤 자동으로 빠짐 */ }
      store.set("ss-lb", null); store.set("ss-lb-sig", ""); store.set("ss-lb-h", ""); toast("랭킹에서 뺐어요"); render();
    };
  });
  const days = (s) => Math.max(0, Math.round((new Date(todayKST()) - new Date(s)) / 864e5));
  const medal = (i) => ["🥇", "🥈", "🥉"][i] || `${i + 1}`;
  // 사람 + AI 계좌를 한 줄로 (AI는 🤖 표시)
  const botRows = B && B.bots ? Object.values(B.bots).filter((b) => (b.hist || []).length).map((b) => ({ nick: b.name, ret: b.ret, start: ymdBot(B.start), tr: (b.log || []).length, bot: 1, td: B.days || 0 })) : [];
  const all = [...rows, ...botRows].sort((a, b) => b.ret - a.ret);
  const people = all.length ? all.slice(0, 60).map((r, i) => `<div class="row" style="padding:6px 0${r.h && r.h === myH ? ";background:var(--soft);border-radius:8px" : ""}">
      <div class="nm"><b>${medal(i)} ${esc(r.nick)}${r.bot ? ' <small class="muted">AI</small>' : ""}${r.h && r.h === myH ? " (나)" : ""}</b><small>${esc(r.start)}부터 · ${r.bot ? `${r.td}거래일째` : `${days(r.start)}일째`} · 거래 ${r.tr}번</small></div>
      <div class="rt"><b class="${cls(r.ret)}">${pctTxt(r.ret * 100, 1)}</b></div></div>`).join("") : `<p class="muted small">아직 아무도 없어요. 첫 번째로 올려 보세요!</p>`;
  const beat = rows.filter((r) => botRows.length && r.ret > Math.max(...botRows.map((b) => b.ret))).length;
  const join = !st ? `<p class="small" style="margin:0">먼저 <a href="#/paper">🎮 가상 계좌</a>를 열고 한 번 이상 사고팔아 보세요.</p>`
    : !st.log.length ? `<p class="small" style="margin:0"><a href="#/paper">🎮 가상 계좌</a>에서 한 번 이상 사면 랭킹에 올릴 수 있어요.</p>`
    : me ? `<p class="small" style="margin:0">'<b>${esc(me.nick)}</b>' 이름으로 올라가 있어요. 가상 계좌를 열 때마다 수익률이 새로 반영돼요.</p><button class="more" id="lbquit" style="margin-top:6px">랭킹에서 빼기</button>`
    : `<p class="small" style="margin:0 0 6px">랭킹에 보일 이름을 정해 주세요 (2~12글자).</p><input id="lbnick" class="num" maxlength="12" placeholder="이름" autocomplete="off"><button class="more" id="lbjoin" style="margin-top:6px">🏆 랭킹에 올리기</button>`;
  // AI 모의투자 계좌
  const bots = B && B.bots ? Object.entries(B.bots).sort((a, b) => b[1].ret - a[1].ret) : [];
  const botHtml = bots.length ? bots.map(([k, b]) => {
    const pos = Object.entries(b.pos || {}), pend = b.pend || [];
    return `<details style="border-bottom:1px solid var(--line);padding:6px 0"><summary style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span><b>${esc(b.name)}</b><br><small class="muted">${esc(b.desc)}</small></span><b class="${cls(b.ret)}">${pctTxt(b.ret * 100, 1)}</b></summary>
      <div class="small" style="margin:6px 0">${pos.length ? `📦 지금 가진 종목: ${pos.map(([c, [q, px, nm]]) => `<a href="#/s/${c}">${esc(nm)}</a>`).join(" · ")}` : ""}
        ${pend.length ? `<br>🛒 다음 거래일 시가에 살 종목: ${pend.map((c) => `<a href="#/s/${c}">${esc((B.pend_names || {})[c] || c)}</a>`).join(" · ")}` : ""}
        ${(b.log || []).filter((x) => x[3] === "S").slice(0, 5).length ? `<br>🧾 최근 판 종목: ${(b.log || []).filter((x) => x[3] === "S").slice(0, 5).map((x) => `${esc(x[2])} <span class="${cls(x[6])}">${pctTxt(x[6] * 100, 1)}</span>`).join(" · ")}` : ""}</div></details>`;
  }).join("") : `<p class="muted small">오늘 오후 5시 계산 뒤부터 매일 자동으로 사고팔아요.</p>`;
  // 과거 1년 매매 방법 비교
  let sgHtml = "";
  const S5 = SG && SG.h && (SG.h[String(H)] || SG.h["5"]);
  if (S5) {
    const L2 = Object.entries(S5.s).sort((a, b) => b[1].ret - a[1].ret);
    sgHtml = `<div class="card"><h2>🧪 과거 1년이었다면? <small>${esc(S5.from)} ~ ${esc(S5.to)} · ${S5.n}번</small></h2><table><tr><th>고르는 방법</th><th class="r">수익</th><th class="r">최대 하락</th></tr>
      ${L2.map(([k, v]) => `<tr><td class="small">${esc(v.name)}${v.win != null ? `<br><small class="muted">평균보다 나은 번 ${v.win}/${S5.n} · 고른 종목 오른 비율 ${Math.round((v.hit || 0) * 100)}%</small>` : ""}</td>
        <td class="r"><b class="${cls(v.ret)}">${pctTxt(v.ret * 100, 1)}</b></td><td class="r ${cls(v.mdd)}">${pctTxt(v.mdd * 100, 0)}</td></tr>`).join("")}</table>
      <p class="muted small">그날까지의 자료로만 배운 AI 확률과, 그날까지 확정된 적중률만 써서 ${SG.h[String(H)] ? H : 5}거래일마다 5종목을 다음 날 시가에 사서 팔았다고 계산했어요 (세금·수수료 뺌, 거래대금 적은 종목·스팩·우선주 뺌). 과거 결과일 뿐이에요.</p></div>`;
  }
  return `<div class="card"><h2>🏆 모의투자 랭킹</h2><p class="small" style="margin:0">가상의 1,000만 원으로 누가 가장 잘 굴리는지 겨뤄요. AI 모의투자 계좌도 함께 겨뤄요.</p></div>
  <div class="card"><h2>🤖 AI 모의투자 계좌 <small>${B && B.start ? esc(ymdBot(B.start)) + "부터 · " + (B.days || 0) + "거래일" : ""}</small></h2>${botHtml}
    <p class="muted small">AI가 매일 오후 5시 계산 뒤 고른 종목을 다음 거래일 시가에 사서 5거래일째 종가에 팔아요. 수수료·세금을 빼고, 진짜 주문은 나가지 않아요. 누르면 가진 종목이 보여요.</p></div>
  <div class="card"><h2>🏆 전체 랭킹 <small>사람 ${rows.length}명 · AI ${botRows.length}개</small></h2>${people}
    ${botRows.length && rows.length ? `<p class="small" style="margin:8px 0 0">🤖 AI 계좌를 모두 이긴 사람: <b>${beat}명</b></p>` : ""}</div>
  <div class="card"><h2>🙋 나도 참가하기</h2>${join}
    <p class="muted small">랭킹 서버에는 정한 이름·수익률·시작일·거래 횟수만 보내요. 종목·금액은 보내지 않아요. 30일 동안 가상 계좌를 열지 않으면 랭킹에서 빠져요. 수익률은 각자 휴대폰에서 계산한 값이에요.</p></div>
  ${sgHtml}${foot()}`;
}, "my");

// ───────── 📖 주식 용어 사전 (사이트 glossary.html과 같은 내용) ─────────
route(/^\/terms(?:\?(.+))?/, async (q0) => {
  let T;
  try { T = await getJSON("terms.json?v=" + VERSION, 86400000); } catch { return `<div class="card">용어 사전을 불러오지 못했어요.</div>${foot()}`; }
  const q = q0 ? decodeURIComponent(q0) : "";
  after(() => {
    const inp = $("#tq"), rows = [...document.querySelectorAll("[data-tk]")], heads = [...document.querySelectorAll("[data-tc]")];
    let cat = "";
    const apply = () => {
      const k = inp.value.trim().toLowerCase().replace(/\s+/g, "");
      let n = 0;
      rows.forEach((r) => { const ok = (!cat || r.dataset.c === cat) && (!k || r.dataset.tk.includes(k)); r.style.display = ok ? "" : "none"; n += ok; });
      heads.forEach((h) => { h.style.display = rows.some((r) => r.dataset.c === h.dataset.tc && r.style.display !== "none") ? "" : "none"; });
      $("#tn").textContent = `${n}개`;
    };
    inp.oninput = apply;
    document.querySelectorAll("[data-tcat]").forEach((b) => b.onclick = () => {
      cat = cat === b.dataset.tcat ? "" : b.dataset.tcat;
      document.querySelectorAll("[data-tcat]").forEach((x) => x.classList.toggle("on", x.dataset.tcat === cat));
      apply();
    });
    apply();
  });
  const body = T.cats.map((c) => `<h2 data-tc="${esc(c)}" style="margin:14px 0 4px">${esc(c)}</h2>` + T.terms.filter((t) => t[0] === c).map(([, n, aka, d, l]) =>
    `<details data-c="${esc(c)}" data-tk="${esc((n + aka + d).toLowerCase().replace(/\s+/g, ""))}" style="border-bottom:1px solid var(--line);padding:6px 0">
      <summary><b>${esc(n)}</b>${aka ? ` <small class="muted">${esc(aka)}</small>` : ""}</summary>
      <p class="small" style="margin:6px 0">${esc(d)}${l ? ` <a href="/${l}">자세히 읽기 ›</a>` : ""}</p></details>`).join("")).join("");
  return `<div class="card"><h2>📖 주식 용어 사전 <small id="tn">${T.terms.length}개</small></h2>
    <input id="tq" class="num" placeholder="용어 검색 (예: PER, 배당락, 공매도)" value="${esc(q)}" autocomplete="off">
    <div class="seg" style="flex-wrap:wrap;margin-top:8px">${T.cats.map((c) => `<button data-tcat="${esc(c)}">${esc(c)}</button>`).join("")}</div></div>
  <div class="card">${body}<p class="muted small">용어를 누르면 풀이가 열려요. 제도와 숫자(세율·거래 시간 등)는 바뀔 수 있으니 거래 전에 증권사 안내도 확인하세요.</p></div>${foot()}`;
}, "more");

let riskTab = store.get("ss-risk", "all");
route(/^\/risk/, async () => {
  view.innerHTML = `<div class="loading">위험 종목 불러오는 중…</div>`;
  await Promise.all([loadIndex(), loadLive()]);
  const O = await DART("ovh.json").catch(() => null);
  const mine = new Set([...favs(), ...holds().map((x) => x[0])]);
  const all = INDEX.map((s) => ({ s, r: riskOf(s, O) })).filter((x) => x.r.length);
  const tabs = [["all", "전체"], ["halt", "⛔ 거래정지"], ["mgd", "🚨 관리"], ["alert", "⚠️ 투자주의·경고"], ["ovh", "💣 물량"]];
  const pick = { all: () => true, halt: (x) => halt(x.s), mgd: (x) => x.s.managed, alert: (x) => !!x.s.alert, ovh: (x) => x.r.some((r) => r[0] === "💣") };
  const list = all.filter(pick[riskTab] || pick.all)
    .sort((a, b) => (mine.has(b.s.code) - mine.has(a.s.code)) || (b.r.filter((r) => r[2]).length - a.r.filter((r) => r[2]).length) || (b.r.length - a.r.length));
  const myHit = all.filter((x) => mine.has(x.s.code));
  after(() => document.querySelectorAll("[data-rt]").forEach((b) => b.onclick = () => { riskTab = b.dataset.rt; store.set("ss-risk", riskTab); render(); }));
  const cnt = (k) => all.filter(pick[k]).length;
  return `<div class="card"><h2>⚠️ 위험 종목 모아 보기 <small>${all.length}종목</small></h2>
    <p class="small" style="margin:0">거래정지·관리종목·투자주의/경고/위험·전환사채 물량이 많은 종목을 한곳에 모았어요. 사기 전에, 그리고 가진 종목이 있다면 꼭 확인해 보세요.</p></div>
  ${mine.size ? `<div class="card"><h2>💼 내 종목 중 <small>관심·산 종목 ${mine.size}개</small></h2>${myHit.length ? myHit.map((x) => riskRow(x)).join("") : `<p class="small" style="margin:0">✅ 내 종목 중에는 위험 신호가 있는 종목이 없어요.</p>`}</div>` : ""}
  <div class="toolbar"><div class="seg" style="flex-wrap:wrap">${tabs.map(([k, l]) => `<button class="${riskTab === k ? "on" : ""}" data-rt="${k}">${l} ${cnt(k)}</button>`).join("")}</div></div>
  <div class="card">${list.slice(0, 150).map((x) => riskRow(x, mine)).join("") || `<p class="muted small">해당하는 종목이 없어요.</p>`}
    ${list.length > 150 ? `<p class="muted small">앞의 150개만 보여 드려요.</p>` : ""}</div>
  <div class="card"><p class="muted small" style="margin:0">⛔ 거래정지: 사고팔 수 없어요 · 🚨 관리종목: 상장폐지 위험이 있다는 표시 · ⚠️ 투자주의→경고→위험: 짧은 기간 크게 오르는 등 이상 급등으로 거래소가 지정 ·
    💣 물량: 지금 가격이면 주식으로 바꾸는 게 이득인 전환사채 등이 전체 주식의 3% 이상. 자세한 설명은 <a href="/trading-halt.html">거래정지 글</a>, <a href="/convertible-bond.html">전환사채 글</a>에 있어요.</p></div>${foot()}`;
}, "themes");
function riskRow(x, mine) {
  const pr = priceOf(x.s);
  return `<a class="row" href="#/s/${x.s.code}"><div class="nm"><b>${mine && mine.has(x.s.code) ? "💼 " : ""}${esc(x.s.name)}</b><small>${x.r.map((r) => `${r[0]} ${r[1]}`).join(" · ")}</small></div>
    <div class="rt"><b>${won(pr.now)}</b><small class="${cls(pr.chg)}">${pctTxt(pr.chg, 1)}</small></div></a>`;
}

const ovhLevel = (o) => (o.open >= 10 ? ["🔴", "높음", "n"] : o.open >= 3 || o.soon >= 5 ? ["🟠", "주의", "z"] : ["🟢", "낮음", "p"]);
async function ovhSection(code, now) {
  const box = $("#ovhbox");
  if (!box) return;
  let O;
  try { O = await DART("ovh.json"); } catch { return; }
  const rows = O.s[code];
  if (!rows || !rows.length) return;
  const o = ovhCalc(rows, now), [ic, lv] = ovhLevel(o), adj = O.adj[code], ex = O.ex[code];
  if (!o.items.length) return;
  box.innerHTML = `<div class="card"><h2>💣 물량 폭탄 경고 <small>${ic} ${lv}</small></h2>
    <div class="sumbox">${o.open > 0 ? `지금 가격이면 주식으로 바꾸는 게 이득이고 바로 바꿀 수 있는 물량이 <b>최대 전체 주식의 ${o.open.toFixed(1)}%</b>예요. 시장에 풀리면 주가에 부담이 될 수 있어요.`
      : o.soon > 0 ? `3개월 안에 바꿀 수 있게 되는 물량이 <b>전체 주식의 ${o.soon.toFixed(1)}%</b> 있어요(지금 가격이면 이득).`
        : `주식으로 바꿀 수 있는 사채가 있지만, 지금 가격이 바꾸는 가격보다 낮아서 당장 풀릴 가능성은 낮아요.`}</div>
    ${o.items.map((x) => `<div class="row" style="display:block;padding:8px 0"><b>${OVK[x.k][0]}</b> <small class="muted">${esc(x.bd || "")} 결정</small>
      ${x.itm ? (x.started ? `<span class="tag n">지금 바꾸면 이득</span>` : `<span class="tag z">이득 · ${esc(x.bgd)}부터</span>`) : `<span class="tag p">아직 손해</span>`}
      <div class="small">${OVK[x.k][1]} <b>${won(x.price)}원</b> (지금 ${x.gap != null ? pctTxt(x.gap * 100, 1) : "-"}) · <b>${won(x.cnt)}주</b>${x.ratio != null ? ` (전체의 ${x.ratio.toFixed(1)}%)` : ""}
        <br><span class="muted">청구 기간 ${esc(x.bgd || "?")} ~ ${esc(x.edd || "?")}${x.floor ? ` · 주가가 내리면 ${OVK[x.k][1]}가 최저 ${won(x.floor)}원까지 낮아질 수 있어요` : ""}</span>
        · <a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${esc(x.rno)}" target="_blank" rel="noopener">공시 보기</a></div></div>`).join("")}
    ${adj || ex ? `<p class="small">${adj ? `🔧 최근 200일 ${OVK[rows[0][0]][1]} 조정 공시 ${adj[0]}건 (마지막 ${esc(adj[1])}) · ` : ""}${ex ? `🔁 주식으로 바꾼 청구 공시 ${ex[0]}건 (마지막 ${esc(ex[1])})` : ""}</p>` : ""}
    ${o.odd ? `<p class="muted small">지금 가격이 전환가의 3배를 넘는 오래된 사채 ${o.odd}건은 이미 주식으로 바뀌었거나 감자·주식 병합으로 비교가 어려워 뺐어요.</p>` : ""}
    <p class="muted small">사채를 가진 사람은 주가가 전환가보다 높으면 주식으로 바꿔 팔아 이익을 낼 수 있어요. 발행 결정 당시 공시 기준이라, 이미 주식으로 바뀌었거나 갚은 물량, 그 뒤 조정된 가격은 빠져 있을 수 있어요.</p></div>`;
}
route(/^\/ovh/, async () => {
  view.innerHTML = `<div class="loading">물량 경고 불러오는 중…</div>`;
  await Promise.all([loadIndex(), loadLive()]);
  const O = await DART("ovh.json");
  const list = Object.entries(O.s).map(([c, rows]) => {
    const s = BYCODE.get(c);
    if (!s || halt(s)) return null;
    const now = priceOf(s).now;
    return { c, s, now, chg: priceOf(s).chg, ...ovhCalc(rows, now) };
  }).filter((x) => x && (x.open > 0 || x.soon > 0)).sort((a, b) => b.open + b.soon * 0.5 - (a.open + a.soon * 0.5));
  return `<div class="card"><h2>💣 물량 폭탄 경고 <small>${esc(O.date)} 공시 기준 · 지금 가격</small></h2>
    <p class="small" style="margin:0">전환사채·신주인수권부사채·교환사채 중 <b>지금 가격이면 주식으로 바꾸는 게 이득</b>인 물량이 많은 종목이에요. 바뀐 주식이 시장에 풀리면 주가가 눌릴 수 있어요.</p></div>
  <div class="card">${list.slice(0, 80).map((x) => {
    const [ic] = ovhLevel(x);
    return `<a class="row" href="#/s/${x.c}"><div class="nm"><b>${ic} ${esc(x.s.name)}</b><small>바로 풀릴 수 있음 최대 ${x.open.toFixed(1)}%${x.soon ? ` · 3개월 안 ${x.soon.toFixed(1)}%` : ""}</small></div>
      <div class="rt"><b>${won(x.now)}</b><small class="${cls(x.chg)}">${pctTxt(x.chg, 1)}</small></div></a>`;
  }).join("") || `<p class="muted small">지금은 해당하는 종목이 없어요.</p>`}</div>
  <div class="card"><p class="muted small" style="margin:0">🔴 바로 풀릴 수 있는 물량이 전체 주식의 10% 이상 · 🟠 3% 이상(또는 3개월 안 5% 이상) · 🟢 그 밖.<br>
    전자공시 '사채권 발행 결정' 자료로 계산했어요. 이미 주식으로 바뀌었거나 갚은 물량은 빠지지 않았을 수 있으니, 종목 화면의 공시 링크로 확인해 보세요.</p></div>${foot()}`;
}, "themes");

// ───────── 🤖 AI 따라 했다면? (확률 상위 5종목) ─────────
route(/^\/aifollow/, async () => {
  view.innerHTML = `<div class="loading">불러오는 중…</div>`;
  let A;
  try { A = await getJSON(DATA + "aifollow.json", 3600000); } catch { A = null; }
  const F = A && (A.h[H] || A.h[String(H)]);
  if (!F) return `<div class="toolbar">${segH()}</div><div class="card"><p class="muted small">아직 자료가 없어요. 매일 오후 5시 계산 뒤에 생겨요.</p></div>${foot()}`;
  const L = F.c[F.c.length - 1];
  after(() => drawLines($("#afcv"), F.c.map((r) => r[0]), [
    { v: F.c.map((r) => r[3] * 100), color: "#9aa3b5", w: 1.5 }, { v: F.c.map((r) => r[4] * 100), color: "--down", w: 1 },
    { v: F.c.map((r) => r[2] * 100), color: "#f59e0b", w: 1 }, { v: F.c.map((r) => r[1] * 100), color: "--up", w: 2.5 }],
    { ref: 0, fmt: (v) => Math.round(v) + "%", h: 220 }));
  const card = (t, v, sub) => `<div class="stat"><small>${t}</small><b class="${cls(v)}">${pctTxt(v * 100, 1)}</b><div class="small muted">${sub}</div></div>`;
  return `<div class="toolbar">${segH()}</div>
  <div class="card"><h2>🤖 AI 따라 했다면? <small>최근 1년 · ${H}거래일마다</small></h2>
    <p class="small" style="margin:0 0 8px">${H}거래일마다 AI <b>상승 확률 상위 ${A.top}종목</b>을 똑같은 돈으로 사서 ${H}거래일 뒤 팔기를 ${F.n}번 했다면?</p>
    <div class="split">${card("AI 상위 5종목 (세금·수수료 뺌)", L[1], `수수료·세금 빼기 전 ${pctTxt(L[2] * 100, 1)}`)}${card("전 종목 평균", L[3], "아무거나 고르기와 같아요")}</div>
    <div class="split" style="margin-top:6px">${card("AI 하위 5종목", L[4], "AI가 '내릴 것'으로 본 종목")}
      <div class="stat"><small>전 종목 평균보다 나았던 번</small><b>${F.win}/${F.n}</b><div class="small muted">고른 종목이 오른 비율 ${Math.round(F.hit * 100)}%</div></div></div>
    <canvas id="afcv" style="margin-top:8px"></canvas>
    ${legend([["var(--up)", "AI 상위 5 (세금·수수료 뺌)"], ["#f59e0b", "빼기 전"], ["#9aa3b5", "전 종목 평균"], ["var(--down)", "AI 하위 5"]])}</div>
  <div class="card"><h2>🗂 최근에 고른 종목</h2><table><tr><th>날짜</th><th>고른 5종목 (확률 → 실제)</th><th class="r">평균</th></tr>
    ${F.last.map(([dt, ra, rall, ps]) => `<tr><td>${ymd(dt).slice(3)}</td><td class="small">${ps.map(([c, nm, p, r]) => `<a href="#/s/${c}">${esc(nm)}</a> ${Math.round(p * 100)}%→<span class="${cls(r)}">${pctTxt(r * 100, 1)}</span>`).join("<br>")}</td>
      <td class="r"><b class="${cls(ra)}">${pctTxt(ra * 100, 1)}</b><br><small class="muted">전체 ${pctTxt(rall * 100, 1)}</small></td></tr>`).join("")}</table></div>
  ${F.last.length && F.last[0][5] ? `<details class="card"><summary><b>🔻 같은 날 AI 하위 5종목</b> <small class="muted">AI가 '내릴 것'으로 본 종목</small></summary><table><tr><th>날짜</th><th>하위 5종목 (확률 → 실제)</th><th class="r">평균</th></tr>
    ${F.last.map(([dt, , rall, , rl, ps]) => `<tr><td>${ymd(dt).slice(3)}</td><td class="small">${(ps || []).map(([c, nm, p, r]) => `<a href="#/s/${c}">${esc(nm)}</a> ${Math.round(p * 100)}%→<span class="${cls(r)}">${pctTxt(r * 100, 1)}</span>`).join("<br>")}</td>
      <td class="r"><b class="${cls(rl)}">${pctTxt(rl * 100, 1)}</b><br><small class="muted">전체 ${pctTxt(rall * 100, 1)}</small></td></tr>`).join("")}</table></details>` : ""}
  <div class="card"><p class="muted small" style="margin:0">계산 방법: 그날까지의 자료로만 배운 AI가 낸 확률(미래 정보 없음)로 상위 ${A.top}종목을 골라, <b>다음 날 시가</b>에 사서 ${H}거래일째 종가에 팔았다고 계산했어요.
    오후 5시에 확률이 나오니 실제로 살 수 있는 가장 빠른 가격이 다음 날 시가예요. 세금·수수료는 한 번 사고팔 때 ${(A.cost * 100).toFixed(2)}%를 뺐어요.
    ${A.skip ? `거래정지 종목, 스팩·우선주, 가격 제한폭(30%)을 넘게 튄 자료(재상장·주식 쪼개기 같은 자료 문제)는 계산에서 뺐어요. ` : ""}1일 전략은 매일 사고팔아 세금·수수료가 크게 쌓여요. 과거 결과일 뿐 앞으로도 같다는 보장은 없어요.</p></div>${foot()}`;
}, "themes");

// ───────── 🔔 내 종목 알림 (앱을 열 때 모아서 보여 줌) ─────────
async function myAlerts() {
  const codes = [...new Set([...favs(), ...holds().map((x) => x[0]), ...Object.keys(tgts())])].slice(0, 40);
  if (!codes.length) return [];
  await Promise.all([loadIndex(), loadLive()]);
  const [ER, O] = await Promise.all([erMap().catch(() => null), DART("ovh.json").catch(() => null)]);
  const out = [];
  const recent = (iso) => ddays(iso) >= -2;
  await Promise.all(codes.map(async (c) => {
    const s = BYCODE.get(c);
    if (!s) return;
    const P = priceOf(s), nm = s.name;
    const th = tgtHit(c, P.now);
    if (th) out.push([0, c, nm, `🎯 목표가 <b>${won(th[1])}원 ${th[0] === "u" ? "이상" : "이하"}</b> 도달 · 지금 ${won(P.now)}원`]);
    if (P.chg != null && Math.abs(P.chg) >= 5) out.push([0, c, nm, `${P.chg > 0 ? "🚀 급등" : "⚠️ 급락"} <b class="${cls(P.chg)}">${pctTxt(P.chg, 1)}</b>${P.live ? " (지금)" : ""}`]);
    const p = s["p" + H], q = s["q" + H];
    if (p != null && q != null && Math.abs(p - q) >= 0.08) out.push([2, c, nm, `🤖 ${H}일 확률 ${Math.round(q * 100)}% → <b>${Math.round(p * 100)}%</b> (${p > q ? "크게 오름" : "크게 내림"})`]);
    if (ER && ER[c] && ddays(ER[c][0]) >= 0 && ddays(ER[c][0]) <= 1) out.push([1, c, nm, `📅 실적 발표 ${ddays(ER[c][0]) === 0 ? "오늘" : "내일"}${ER[c][1] === "예상" ? " (예상)" : ""}`]);
    if (O && O.s[c]) { const o = ovhCalc(O.s[c], P.now); if (o.open >= 3) out.push([3, c, nm, `💣 지금 가격이면 풀릴 수 있는 물량 ${o.open.toFixed(1)}%`]); }
    try {
      const d = await DART(`d/${c}.json`);
      (d.disc || []).filter((x) => recent(x[0])).slice(0, 2).forEach((x) => out.push([1, c, nm, `📢 공시 ${esc(x[1])} <small class="muted">${esc(x[0].slice(5))}</small>`]));
    } catch { /* 공시 파일 없음 */ }
  }));
  return out.sort((a, b) => a[0] - b[0]);
}
const alertHtml = (al, n) => !al.length ? "" : `<div class="card"><h2>🔔 내 종목 알림 <small>${al.length}개</small></h2>
  ${al.slice(0, n).map(([, c, nm, t]) => `<a class="row" href="#/s/${c}" style="padding:6px 0"><div class="nm"><b>${esc(nm)}</b><small>${t}</small></div></a>`).join("")}
  ${al.length > n ? `<a class="more" href="#/my">알림 ${al.length - n}개 더 보기 ›</a>` : ""}
  <p class="muted small">관심·산 종목의 급등락(±5%), AI 확률 큰 변화(8%p 이상), 최근 공시, 실적 발표, 물량 경고를 모았어요. 앱을 열 때마다 새로 확인해요.</p></div>`;

// ───────── 🔔 휴대폰 알림 (구독 주소와 관심 종목 코드만 알림 서버에 보냄) ─────────
const PUSH_URL = "https://stocksignals-push.7415794.workers.dev";
const VAPID = "BE4j44JuHrJKfDVxmiW-Ky3pSElkR520_F1F74B9cimfCFHO79M0gtjgl8r62FZbWIybGk_yQtq2NTnmc0dkS1I";
const PUSH_KINDS = [["move", "🚀 장중 급등락", "내 종목이 ±5% 넘게 움직이면 (장중 20분마다 확인)"],
  ["daily", "📋 장 마감 정리", "AI 확률 큰 변화·새 공시·내일 실적 발표 (오후 5시 계산 뒤) · 금요일엔 주간 리포트"],
  ["issue", "🔥 오늘 이슈", "내 종목이 들어간 새 시장 이슈가 뜨면"]];
const pushOK = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const pushKinds = () => store.get("ss-push-kinds", PUSH_KINDS.map((k) => k[0]));
const b64u = (s) => { const b = atob((s + "===".slice((s.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function pushSub() { try { return await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch { return null; } }
async function pushSync(force) {
  if (!pushOK()) return false;
  const s = await pushSub();
  if (!s) return false;
  const codes = [...new Set([...favs(), ...holds().map((x) => x[0])])];
  const tg = tgts();
  const sig = JSON.stringify([codes, pushKinds(), s.endpoint.slice(-20), todayKST().slice(0, 7), tg]);
  if (!force && store.get("ss-push-sig", "") === sig) return true;
  try {
    const r = await fetch(PUSH_URL + "/sub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub: s.toJSON(), codes, kinds: pushKinds(), tg }) });
    if (r.ok) store.set("ss-push-sig", sig);
    return r.ok;
  } catch { return false; }
}
async function pushOn() {
  if (!pushOK()) { toast("이 기기·브라우저는 알림을 지원하지 않아요"); return false; }
  const p = await Notification.requestPermission();
  if (p !== "granted") { toast("알림이 허용되지 않았어요. 휴대폰 설정에서 이 앱의 알림을 켜 주세요"); return false; }
  const reg = await navigator.serviceWorker.ready;
  let s = await reg.pushManager.getSubscription();
  if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID) });
  const ok = await pushSync(true);
  toast(ok ? "🔔 알림을 켰어요" : "알림 서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요");
  return ok;
}
async function pushOff() {
  const s = await pushSub();
  if (s) {
    try { await fetch(PUSH_URL + "/unsub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: s.endpoint }) }); } catch { /* 서버에서는 90일 뒤 자동 삭제 */ }
    await s.unsubscribe();
  }
  store.set("ss-push-sig", "");
  toast("알림을 껐어요");
}
async function pushCard() {
  if (!pushOK()) return `<div class="card"><h2>🔔 휴대폰 알림</h2><p class="muted small" style="margin:0">이 기기·브라우저에서는 알림을 받을 수 없어요. 안드로이드 크롬이나 앱 최신 버전에서 켤 수 있어요.</p></div>`;
  const on = !!(await pushSub()) && Notification.permission === "granted";
  if (on) pushSync();
  const ks = pushKinds();
  after(() => {
    $("#pushbtn").onclick = async () => { on ? await pushOff() : await pushOn(); render(); };
    document.querySelectorAll("[data-pk]").forEach((c) => c.onchange = () => {
      const v = PUSH_KINDS.map((k) => k[0]).filter((k) => document.querySelector(`[data-pk="${k}"]`).checked);
      store.set("ss-push-kinds", v); pushSync(true);
    });
  });
  return `<div class="card"><h2>🔔 휴대폰 알림 <small>${on ? "켜짐" : "꺼짐"}</small></h2>
    ${on ? PUSH_KINDS.map(([k, t, d]) => `<label class="small" style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><input type="checkbox" data-pk="${k}" ${ks.includes(k) ? "checked" : ""}><span><b>${t}</b><br><span class="muted">${d}</span></span></label>`).join("")
      : `<p class="small" style="margin:0 0 6px">관심 종목·산 종목이 크게 움직이거나 새 공시가 나오면 앱을 열지 않아도 알려 드려요.</p>`}
    <button class="more" id="pushbtn">${on ? "알림 끄기" : "🔔 알림 켜기"}</button>
    <p class="muted small">알림을 보내려고 이 휴대폰의 알림 주소와 내 종목 코드(목표가 알림을 정했다면 그 가격도)만 알림 서버(Cloudflare)에 저장해요. 이름·산 가격·수량은 보내지 않아요. 90일 동안 앱을 열지 않으면 자동으로 지워져요.</p></div>`;
}

// ───────── 🧮 물타기·손익 계산기 (모두 이 휴대폰에서만 계산) ─────────
const CALC0 = { avg: "", qty: "", now: "", add: "", addq: "", goal: "", fee: 0.015, tax: 0.2 };
route(/^\/calc(?:\?([0-9A-Z]{6}))?/, async (code) => {
  await Promise.all([loadIndex(), loadLive()]);
  const st = Object.assign({}, CALC0, store.get("ss-calc", {}));
  let nm = "";
  if (code) {
    const s = BYCODE.get(code);
    if (s) {
      nm = s.name;
      const now = priceOf(s).now;
      const h = holds().find((x) => x[0] === code);
      if (st.code !== code) Object.assign(st, { avg: h ? Math.round(h[2]) : "", qty: h ? h[3] : "", add: "", addq: "", goal: "" });
      if (now) Object.assign(st, { now, add: st.add || now });
      st.code = code;
    }
  }
  const F = [["avg", "내 평균 단가 (원)"], ["qty", "가진 수량 (주)"], ["now", "지금 가격 (원)"],
    ["add", "추가로 살 가격 (원)"], ["addq", "추가로 살 수량 (주)"], ["goal", "만들고 싶은 평균 단가 (원, 선택)"]];
  after(() => {
    const calc = () => {
      const v = {};
      for (const k of Object.keys(CALC0)) { const e = $("#c_" + k); v[k] = e ? e.value : ""; }
      store.set("ss-calc", { ...v, code: st.code || "" });
      const n = (k) => parseFloat(String(v[k]).replace(/,/g, "")) || 0;
      const avg = n("avg"), qty = n("qty"), now = n("now"), add = n("add") || now, addq = n("addq"), goal = n("goal");
      const fee = n("fee") / 100, tax = n("tax") / 100;
      const out = [];
      if (avg > 0 && qty > 0) {
        const cost = avg * qty * (1 + fee);
        const even = avg * (1 + fee) / (1 - fee - tax);
        out.push(`<p class="small" style="margin:6px 0 2px"><b>💰 지금 다 팔면</b></p>`);
        if (now > 0) {
          const sell = now * qty, minus = sell * (fee + tax), net = sell - minus - cost;
          out.push(`<div class="split"><div class="stat"><small>실제 손익 (세금·수수료 뺀 것)</small><b class="${cls(net)}">${net > 0 ? "+" : ""}${won(Math.round(net))}원</b>
            <div class="small ${cls(net)}">${pctTxt(net / cost * 100, 2)}</div></div>
            <div class="stat"><small>나가는 세금·수수료</small><b>${won(Math.round(minus + avg * qty * fee))}원</b><div class="small muted">살 때+팔 때</div></div></div>`);
        }
        out.push(`<p class="small">본전 가격은 <b>${won(Math.ceil(even))}원</b>이에요${now > 0 ? ` (지금보다 <b class="${cls(even - now)}">${pctTxt((even / now - 1) * 100, 1)}</b>)` : ""}. 세금·수수료까지 내고 손해가 없는 가격이에요.</p>`);
        if (addq > 0 && add > 0) {
          const q2 = qty + addq, a2 = (avg * qty + add * addq) / q2, even2 = a2 * (1 + fee) / (1 - fee - tax);
          out.push(`<p class="small" style="margin:12px 0 2px"><b>➕ ${won(add)}원에 ${won(addq)}주 더 사면</b></p>
            <div class="split"><div class="stat"><small>새 평균 단가</small><b>${won(Math.round(a2))}원</b><div class="small muted">${pctTxt((a2 / avg - 1) * 100, 1)} 바뀜</div></div>
            <div class="stat"><small>새 수량 · 더 드는 돈</small><b>${won(q2)}주</b><div class="small muted">${won(Math.round(add * addq * (1 + fee)))}원</div></div></div>
            <p class="small">새 본전 가격 <b>${won(Math.ceil(even2))}원</b>${now > 0 ? ` (지금보다 ${pctTxt((even2 / now - 1) * 100, 1)})` : ""} · 이 종목에 들어간 돈은 모두 <b>${won(Math.round((avg * qty + add * addq) * (1 + fee)))}원</b>이에요.</p>`);
        }
        if (goal > 0 && add > 0) {
          let g = "";
          if (!(add < goal && goal < avg) && !(add > goal && goal > avg)) g = `추가로 살 가격(${won(add)}원)으로는 평균 단가를 ${won(goal)}원으로 만들 수 없어요. 목표가 지금 평균 단가와 살 가격 사이에 있어야 해요.`;
          else {
            const need = Math.ceil(qty * (avg - goal) / (goal - add));
            g = `${won(add)}원에 <b>${won(need)}주</b>(약 ${won(Math.round(need * add))}원)를 더 사야 평균 단가가 ${won(goal)}원이 돼요.`;
          }
          out.push(`<p class="small" style="margin:12px 0 2px"><b>🎯 목표 평균 단가</b></p><p class="small">${g}</p>`);
        }
      } else out.push(`<p class="muted small">평균 단가와 수량을 넣으면 바로 계산해요.</p>`);
      $("#cout").innerHTML = out.join("");
    };
    document.querySelectorAll("#cform input").forEach((e) => e.oninput = calc);
    $("#creset").onclick = () => { store.set("ss-calc", {}); location.hash = "#/calc"; render(); };
    calc();
  });
  const hs = holds();
  return `<div class="card"><h2>🧮 물타기·손익 계산기 ${nm ? `<small>${esc(nm)}</small>` : ""}</h2>
    ${hs.length ? `<div class="chips" style="margin:0 0 8px">${hs.map(([c, name]) => `<a class="chip" href="#/calc?${c}">${esc(name)}</a>`).join("")}</div>
      <p class="muted small" style="margin:0 0 8px">💼 내가 산 종목을 누르면 평균 단가·수량·지금 가격을 채워 줘요.</p>` : ""}
    <div id="cform" style="display:grid;gap:6px">${F.map(([k, l]) => `<label class="small">${l}<input id="c_${k}" class="num" type="number" inputmode="decimal" value="${esc(st[k])}"></label>`).join("")}
      <details><summary class="small">수수료·세금 바꾸기</summary><div class="split" style="margin-top:6px">
        <label class="small">수수료 (%, 살 때·팔 때 각각)<input id="c_fee" class="num" type="number" inputmode="decimal" step="0.001" value="${esc(st.fee)}"></label>
        <label class="small">팔 때 세금 (%)<input id="c_tax" class="num" type="number" inputmode="decimal" step="0.01" value="${esc(st.tax)}"></label></div></details></div>
    <div id="cout" style="margin-top:10px"></div>
    <button class="more" id="creset" style="margin-top:8px">처음부터 다시</button>
    <p class="muted small">팔 때 세금 0.20%는 2026년 코스피·코스닥 기준(증권거래세+농어촌특별세)이고, 수수료는 증권사마다 달라요. 계산은 이 휴대폰에서만 해요.</p></div>${foot()}`;
}, "my");

// ───────── 🔎 조건검색 ─────────
let scState = Object.assign({ prob: 60, hit: 100, mkt: "ALL", price: "all", safe: true }, store.get("ss-sc", {}));
let scShow = 30;
route(/^\/screen/, async () => {
  await Promise.all([loadIndex(), loadLive()]);
  const k = "p" + H, hk = "hr" + H;
  let d = INDEX.filter((s) => s[k] != null && !halt(s) && s[k] >= scState.prob / 100);
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
    const all = INDEX.filter((s) => s["a" + h] != null && !halt(s));
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
route(/^\/cmp(?:\?([0-9A-Z]{6})?-([0-9A-Z]{6})?)?/, async (a, b) => {
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
// 앱(설치된 화면)으로 열었는지: 앱 안에서는 APK 받기 칸을 숨김
const inApp = () => matchMedia("(display-mode: standalone)").matches || document.referrer.startsWith("android-app://");
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });
// 📂 전체 메뉴 (묶음별) + ✏️ 홈 메뉴 편집
let menuEdit = false;
function menuAll() {
  const pin = store.get("ss-pin", null), auto = !(Array.isArray(pin) && pin.length);
  const sel = menuEdit ? (store.get("ss-pin-draft", null) || homeMenu().map((c) => c[0])) : [];
  after(() => {
    document.body.classList.toggle("menu-edit", menuEdit);
    $("#medit").onclick = () => {
      if (menuEdit) { store.set("ss-pin", sel); store.set("ss-pin-draft", null); toast("🏠 홈 메뉴를 저장했어요"); }
      else store.set("ss-pin-draft", homeMenu().map((c) => c[0]));
      menuEdit = !menuEdit; render();
    };
    const ra = $("#mauto");
    if (ra) ra.onclick = () => { store.set("ss-pin", null); store.set("ss-pin-draft", null); menuEdit = false; toast("자주 쓰는 순서로 자동 정리해요"); render(); };
    if (menuEdit) document.querySelectorAll(".cats a[data-m]").forEach((a) => a.onclick = (e) => {
      e.preventDefault();
      const u = a.dataset.m, d = [...sel], k = d.indexOf(u);
      if (k >= 0) d.splice(k, 1);
      else if (d.length >= HOME_N) return toast(`홈에는 ${HOME_N}개까지 놓을 수 있어요. 먼저 하나를 빼 주세요`);
      else d.push(u);
      store.set("ss-pin-draft", d); render();
    });
  });
  const groups = MENU.map(([g, items]) => `<p class="small" style="margin:10px 0 6px"><b>${g}</b></p><div class="cats" style="margin:0">${items.map((c) => {
    const k = sel.indexOf(c[0]);
    return menuEdit ? tile([c[0], c[1], c[2] + (k >= 0 ? ` <span class="pinno">${k + 1}</span>` : "")], ` class="${k >= 0 ? "picked" : ""}"`) : tile(c);
  }).join("")}</div>`).join("");
  return `<div class="card"><h2 style="display:flex;justify-content:space-between;align-items:center">📂 전체 메뉴
      <button class="icon-btn" id="medit">${menuEdit ? "✅ 저장" : "✏️ 홈 메뉴 편집"}</button></h2>
    ${menuEdit ? `<p class="small" style="margin:0 0 4px">홈 위쪽에 놓을 화면을 순서대로 눌러 주세요 (<b>${sel.length}/${HOME_N}</b>). 다시 누르면 빠져요. 다 고르면 '✅ 저장'.</p>`
      : `<p class="muted small" style="margin:0">홈 위쪽에는 ${auto ? "<b>자주 쓰는 화면 7개</b>가 저절로 놓여요 (이 휴대폰에서 누른 횟수 기준)" : "<b>직접 고른 화면 7개</b>가 놓여 있어요"}.</p>`}
    ${groups}
    ${!auto || menuEdit ? `<button class="more" id="mauto" style="margin-top:10px">🔄 자주 쓰는 순서로 자동 정리</button>` : ""}
    <p class="muted small">아래 탭: 🏠 홈(종목 검색·분석) · 🏆 순위 · 🧩 테마 · ⭐ 내 종목</p></div>`;
}
route(/^\/more/, async () => {
  await loadIndex().catch(() => null);
  const th = store.get("ss-theme", "auto");
  after(() => {
    document.querySelectorAll("[data-th]").forEach((b) => b.onclick = () => { store.set("ss-theme", b.dataset.th); applyTheme(); render(); });
    const ib = $("#install");
    if (ib) ib.onclick = async () => { if (installEvt) { installEvt.prompt(); installEvt = null; } };
    $("#introagain").onclick = () => showIntro(0);
    $("#refresh").onclick = () => { memo.clear(); INDEX = null; for (const o of [hitPool, orderMemo]) for (const k in o) delete o[k]; toast("새로 불러왔어요"); location.hash = "#/"; render(); };
  });
  const link = (u, t) => `<a class="row" href="${u}"><div class="nm"><b>${t}</b></div><span class="muted">›</span></a>`;
  return `${menuAll()}
  <div class="card"><h2>⚙️ 설정</h2>
    <div class="row"><div class="nm"><b>화면 색</b></div><div class="seg">${[["auto", "자동"], ["light", "밝게"], ["dark", "어둡게"]]
      .map(([v, l]) => `<button data-th="${v}" class="${v === th ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="row"><div class="nm"><b>기본 예측 기간</b></div>${segH()}</div>
    <div class="row"><div class="nm"><b>자료 새로 받기</b><small>AI 기준일 ${esc(META?.date || "-")} · 계산 ${esc(META?.built_at || "-")}</small></div><button class="icon-btn" id="refresh">새로 고침</button></div>
    ${installEvt ? `<div class="row"><div class="nm"><b>홈 화면에 앱 추가</b></div><button class="icon-btn" id="install">추가</button></div>` : ""}</div>
  ${inApp() ? "" : `<div class="card"><h2>📱 안드로이드 앱 받기</h2>
    <a class="row" href="stocksignals.apk" download><div class="nm"><b>스톡시그널 앱 내려받기 (APK)</b><small>약 1.3MB · 안드로이드 휴대폰 전용</small></div><span class="icon-btn">받기</span></a>
    <p class="muted small" style="margin:6px 0 0">받은 파일을 눌러 설치해요. "출처를 알 수 없는 앱" 허용을 물으면 이 브라우저에 허용해 주세요.
    나중에 플레이스토어 버전이 나오면, 이 앱을 지우고 스토어에서 다시 설치해 주세요.</p></div>`}
  <div class="card"><h2>📚 알아보기</h2>
    ${link("/guide.html", "사용 설명서")}${link("/ai-probability.html", "AI 확률은 어떻게 계산하나요?")}${link("/hit-rate.html", "적중률 보는 법")}
    ${link("/research.html", "연구 기록 (무엇을 시험했나)")}${link("/faq.html", "자주 묻는 질문")}<a class="row" href="javascript:void 0" id="introagain"><div class="nm"><b>👋 처음 안내 다시 보기</b></div><span class="muted">›</span></a></div>
  <div class="card"><h2>ℹ️ 정보</h2>${link("/about.html", "스톡시그널 소개·문의")}${link("/privacy.html", "개인정보처리방침")}${link("/disclaimer.html", "면책 고지")}
    <p class="muted small">버전 ${VERSION} · 시세: 네이버 증권 · 뉴스: Google 뉴스</p></div>${foot()}`;
}, "more");

// ───────── 시작 ─────────
render();
if (!store.get("ss-intro", 0) && !location.hash.startsWith("#/s/")) setTimeout(() => showIntro(0), 900);
lastHash = location.hash;
setInterval(() => {  // 장중엔 5분마다 현재가 다시 받기 (화면 보고 있을 때만)
  if (document.hidden) return;
  const h = new Date(Date.now() + 9 * 3600e3);
  const hm = h.getUTCHours() * 100 + h.getUTCMinutes(), wd = h.getUTCDay();
  if (wd === 0 || wd === 6 || hm < 800 || hm > 1600) return;
  Promise.all([loadLive(true), loadIssues(true)]).then(() => { if (/^(#\/?|#\/rank|#\/my|#\/issues)?$/.test(location.hash) && !document.querySelector("#q:focus")) render(); });
}, 300000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// app.js — ASCII-only
"use strict";

console.log("Crowdsense app v40");

// ===== fallback data (if sheet fails) =====
var QUESTIONS = [
  { question: "Name a bill people most worry about going up",
    answers: [
      { text: "Energy", aliases: ["gas","electric","electricity","power","heating"], score: 42 },
      { text: "Rent", aliases: ["renting"], score: 18 },
      { text: "Mortgage", aliases: ["mortgages"], score: 14 },
      { text: "Water", aliases: ["water rates"], score: 10 },
      { text: "Council Tax", aliases: ["council","local tax"], score: 9 },
      { text: "Food", aliases: ["groceries","supermarket"], score: 5 }
    ]
  }
];

// ===== state =====
var idx = 0, score = 0, revealed = new Set(), strikes = 0, endReason = "complete";
var els = {
  questionText: document.getElementById("questionText"),
  board: document.getElementById("board"),
  input: document.getElementById("guessInput"),
  guessBtn: document.getElementById("guessBtn"),
  nextBtn: document.getElementById("nextBtn"),
  score: document.getElementById("score"),
  strike1: document.getElementById("strike1"),
  strike2: document.getElementById("strike2"),
  strike3: document.getElementById("strike3"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  modalClose: document.getElementById("modalClose"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  dailyDate: document.getElementById("dailyDate"),
  streakPill: document.getElementById("streakPill"),
  badgeRow: document.getElementById("badgeRow"),
  emailForm: document.getElementById("emailForm"),
  emailInput: document.getElementById("emailInput"),
  emailMsg: document.getElementById("emailMsg"),
  sourceNote: document.getElementById("sourceNote"),
  strikeToast: document.getElementById("strikeToast")
};

// ===== normalisation =====
function norm(s){
  s = String(s || "");
  return s
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[-_/]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ===== daily mode / constants =====
const DAILY_MODE = true;
const DAILY_TZ   = "Europe/London";
const MAX_ANSWERS = 5;
const BLUR_ON_CORRECT = true;
const GLOBAL_ANCHOR = "2025-07-09"; // fixed so everyone sees the same question

function safeTZ(){
  var tz = DAILY_TZ || "Europe/London";
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }).format(new Date()); return tz; }
  catch (e) { return "Europe/London"; }
}

var DAY_KEY = null;
function getDayKey(){
  var now = new Date();
  var fmt = new Intl.DateTimeFormat("en-GB", { timeZone: safeTZ(), year:"numeric", month:"2-digit", day:"2-digit" });
  var parts = fmt.formatToParts(now);
  var y="",m="",d="";
  for (var i=0;i<parts.length;i++){
    if (parts[i].type==="year") y=parts[i].value;
    else if (parts[i].type==="month") m=parts[i].value;
    else if (parts[i].type==="day") d=parts[i].value;
  }
  return y+"-"+m+"-"+d;
}

// live date/time ticker
var _tickerId = null;
function startDailyTickerLondon(){
  if (!els.dailyDate) return;
  if (_tickerId) { clearInterval(_tickerId); _tickerId = null; }
  var tz = safeTZ();
  function render(){
    var now = new Date();
    var dateStr = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(now);
    var timeStr = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
    els.dailyDate.textContent = "Daily \u00B7 " + dateStr + " \u00B7 " + timeStr;
  }
  render();
  _tickerId = setInterval(render, 1000);
}

// deterministic pick helpers
function ymdFromKey(key){ var p = key.split("-"); return { y:+p[0], m:+p[1], d:+p[2] }; }
function daysFromYMD(y,m,d){ return Math.floor(Date.UTC(y, m-1, d) / 86400000); }
function daysSince(aKey, bKey){
  var a = ymdFromKey(aKey), b = ymdFromKey(bKey);
  return daysFromYMD(b.y,b.m,b.d) - daysFromYMD(a.y,a.m,a.d);
}
function normalizeId(s){ return String(s||"").trim().toLowerCase(); }

function buildQuestionMap(){
  var arr = [];
  for (var i=0;i<QUESTIONS.length;i++){
    var id = normalizeId(QUESTIONS[i].question);
    if (!arr.some(function(x){ return x.id === id; })) arr.push({ id:id, idx:i });
  }
  arr.sort(function(a,b){ return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
  return arr;
}
function pickIndexGlobal(qMap, todayKey){
  var total = qMap.length;
  if (!total) return 0;
  var offset = daysSince(GLOBAL_ANCHOR, todayKey);
  if (offset < 0) offset = -offset;
  var pos = offset % total;
  return qMap[pos].idx;
}

// modal
function showModal(title, message){
  if (!els.modal) return;
  els.modalTitle.textContent = title || "";
  els.modalBody.textContent = message || "";
  els.modal.classList.remove("hidden");
}
function showModalHTML(title, html){
  if (!els.modal) return;
  els.modalTitle.textContent = title || "";
  els.modalBody.innerHTML = html || "";
  els.modal.classList.remove("hidden");
}
function hideModal(){ if (!els.modal) return; els.modal.classList.add("hidden"); }
if (els.modalClose) els.modalClose.addEventListener("click", hideModal);
if (els.modalBackdrop) els.modalBackdrop.addEventListener("click", hideModal);
document.addEventListener("keydown", function(e){ if (e.key === "Escape") hideModal(); });

// email capture
function handleEmailSubmit(e){
  if (!els.emailForm) return;
  e.preventDefault();
  var email = (els.emailInput && els.emailInput.value || "").trim();
  if (!email) return;
  els.emailMsg.textContent = "Submitting...";
  var fd = new FormData(els.emailForm);
  fetch(els.emailForm.action, { method:"POST", headers:{ "Accept":"application/json" }, body: fd })
    .then(function(res){ if (res.ok) return res.json(); throw new Error("Subscribe failed"); })
    .then(function(){ els.emailMsg.textContent = "Thanks! Check your inbox to confirm."; try{ els.emailForm.reset(); }catch(_){ } })
    .catch(function(){ els.emailMsg.textContent = "Sorry\u2014there was a problem. Please try again."; });
}

// strikes UI
function updateStrikes(){
  var dots = [els.strike1, els.strike2, els.strike3];
  for (var i=0;i<dots.length;i++){
    if (!dots[i]) continue;
    dots[i].classList.toggle("active", strikes > i);
    dots[i].style.opacity = (strikes > i ? 1 : 0.25);
  }
}
function ensureSourceNote(){
  var note = document.getElementById("sourceNote");
  if (!note) {
    note = document.createElement("p");
    note.id = "sourceNote";
    note.className = "source-note";
    note.textContent = "Source: Public First Poll of 2,106 UK Adults from 9th Jul \u2013 14th July 2025";
  }
  els.board.insertAdjacentElement("afterend", note);
  els.sourceNote = note;
}
function strikeFeedback(n){
  var dots = [els.strike1, els.strike2, els.strike3];
  var target = dots[n-1];
  if (target){ target.classList.add("boom"); setTimeout(function(){ target.classList.remove("boom"); }, 600); }
  if (els.input){ els.input.classList.add("shake"); setTimeout(function(){ els.input.classList.remove("shake"); }, 450); }
  var card = document.getElementById("card");
  if (card){ card.classList.add("card-flash"); setTimeout(function(){ card.classList.remove("card-flash"); }, 300); }
  if (els.strikeToast){
    els.strikeToast.textContent = "Strike " + n + " of 3";
    els.strikeToast.classList.add("show");
    setTimeout(function(){ els.strikeToast.classList.remove("show"); }, 1200);
  }
}

// ===== minimal streak + badges =====
function getJSON(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(_){ return d; } }
function setJSON(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); } catch(_){} }

// Only two badge types:
// - "win" (earned on any win, shown today only)
// - "hot-streak" (earned when you set a new best streak >= 3)
function awardToday(id, label, icon){
  var todayKey = getJSON("cs_badges_today_at", "");
  var today = getJSON("cs_badges_today", []);
  if (todayKey !== DAY_KEY){ today = []; }
  var entry = icon + " " + label;
  if (today.indexOf(entry) === -1){ today.push(entry); }
  setJSON("cs_badges_today_at", DAY_KEY);
  setJSON("cs_badges_today", today);
}
function renderBadgeRowForToday(){
  if (!els.badgeRow) return;
  var todayKey = getJSON("cs_badges_today_at", "");
  var today = (todayKey === DAY_KEY) ? getJSON("cs_badges_today", []) : [];
  els.badgeRow.innerHTML = "";
  today.forEach(function(text){
    var chip = document.createElement("span");
    chip.className = "badge-item";
    chip.textContent = text;
    els.badgeRow.appendChild(chip);
  });
}
function renderStreakPill(){
  if (!els.streakPill) return;
  var cur = getJSON("cs_streak_current", 0);
  if (cur >= 2){
    els.streakPill.textContent = "🔥 " + cur + " day streak";
    els.streakPill.style.display = "inline-flex";
  } else {
    els.streakPill.textContent = "";
    els.streakPill.style.display = "none";
  }
}
function updateStreaksAndBadges(won){
  var cur = getJSON("cs_streak_current", 0);
  var best = getJSON("cs_streak_best", 0);

  if (won){
    cur += 1; if (cur > best){ best = cur; }
    setJSON("cs_streak_current", cur);
    setJSON("cs_streak_best", best);

    // Always award a simple Win badge (today only)
    awardToday("win", "Win", "🏆");

    // If new best and at least 3, award a Hot Streak badge (today only)
    if (cur === best && best >= 3){
      awardToday("hot-streak", "Hot streak " + best, "🔥");
    }
  } else {
    setJSON("cs_streak_current", 0);
  }
}

// ===== UI: render question =====
function renderQuestion(){
  var q = QUESTIONS[idx];
  endReason = "complete";
  els.questionText.textContent = q.question;
  els.board.innerHTML = "";
  revealed = new Set();
  strikes = 0; updateStrikes();
  if (els.nextBtn) els.nextBtn.classList.add("hidden");
  els.input.disabled = false; els.guessBtn.disabled = false;
  els.input.value = "";
  try{ els.input.focus(); }catch(_){}
  if (els.score) els.score.textContent = "0%";

  var count = Math.min(q.answers.length, MAX_ANSWERS);
  for (var i=0;i<count;i++){
    var tile = document.createElement("div");
    tile.className = "tile";
    tile.setAttribute("data-index", String(i));
    tile.innerHTML = '<div class="fill"></div><div class="tile-content"><span class="answer">\u2014 \u2014 \u2014</span><span class="points">??</span></div>';
    els.board.appendChild(tile);
  }

  // reset per-round flags
  window._guessedOnce = false;
  window._firstGuessWasTop = false;

  ensureSourceNote();
  renderStreakPill();
  renderBadgeRowForToday();
}

function finishRound(reason){
  els.input.disabled = true; els.guessBtn.disabled = true;
  if (els.nextBtn) els.nextBtn.classList.add("hidden");

  var q = QUESTIONS[idx];
  var won = (reason !== "failed");

  updateStreaksAndBadges(won);
  renderStreakPill();
  renderBadgeRowForToday();

  if (!won){
    els.questionText.textContent = q.question + " - You're out of guesses!";
    showModal("You're out of guesses!", "Try again tomorrow.");
  } else {
    els.questionText.textContent = q.question + " - All answers revealed!";
    showModalHTML("You revealed them all!", "Nice work. Come back tomorrow for a new question.");
  }

  if (DAILY_MODE){
    try{ localStorage.setItem("played-"+DAY_KEY, "1"); }catch(_){}
  }
}

function reveal(i){
  var q = QUESTIONS[idx];
  var ans = q.answers[i];
  var tile = els.board.children[i];
  if (!tile || !ans) return;

  var fill = tile.querySelector(".fill");
  var answerEl = tile.querySelector(".answer");
  var pointsEl = tile.querySelector(".points");

  var onDone = function(){
    tile.classList.add("revealed");
    answerEl.textContent = ans.text;
    pointsEl.textContent = ans.score + "%";
    if (!revealed.has(i)){
      revealed.add(i);
      score += ans.score;
      if (els.score) els.score.textContent = score + "%";
    }
    fill.removeEventListener("transitionend", onDone);

    var totalToReveal = Math.min(q.answers.length, els.board.children.length);
    if (revealed.size >= totalToReveal) finishRound(endReason);
  };

  fill.addEventListener("transitionend", onDone);
  requestAnimationFrame(function(){ fill.style.width = ans.score + "%"; });
}

function handleGuess(){
  var raw = els.input ? els.input.value : "";
  var guess = norm(raw);
  if (!guess) return;

  var q = QUESTIONS[idx];

  // track if first guess equals top answer (not used for badges now, but harmless to keep)
  if (!window._guessedOnce){
    window._guessedOnce = true;
    var top = (q.answers[0] || {}).text || "";
    if (norm(raw) && norm(top) && norm(raw) === norm(top)){
      window._firstGuessWasTop = true;
    }
  }

  var foundIndex = -1;
  var visibleCount = Math.min(q.answers.length, els.board.children.length || MAX_ANSWERS);
  for (var i=0; i<visibleCount; i++){
    if (revealed.has(i)) continue;
    var ans = q.answers[i];
    var candidates = [ans.text].concat(ans.aliases||[]).map(norm);
    if (candidates.indexOf(guess) !== -1){
      foundIndex = i; break;
    }
  }

  if (foundIndex !== -1){
    reveal(foundIndex);
    if (BLUR_ON_CORRECT && els.input){ setTimeout(function(){ els.input.blur(); }, 0); }
    els.input.value = "";
    return;
  }

  strikes = Math.min(strikes+1, 3);
  updateStrikes();
  strikeFeedback(strikes);
  if (strikes >= 3){
    endReason = "failed";
    q.answers.forEach(function(_,i){ if (!revealed.has(i)) reveal(i); });
  }
}

// ===== Google Sheets loader (CSV first, GViz fallback) =====
var SHEET_PUBLISHED_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR6_gEjPFb7k4tHmguxmp_4qHlObR7JAY5V1UtktCGS0BbfoehJd13fYv5iI4qZ1HjlEwkUxGqM0Aod/pubhtml";

function normalizeToCSV(url){
  if (!url) return "";
  var m = /gid=([0-9]+)/.exec(url); var gid = m ? "&gid="+m[1] : "";
  if (/\/pubhtml(\?|$)/.test(url)) return url.replace(/\/pubhtml(\?.*)?$/,"/pub?output=csv"+gid);
  if (/\/pub(\?|$)/.test(url) && url.indexOf("output=csv")===-1) return url.replace(/\/pub(\?.*)?$/,"/pub?output=csv");
  return url;
}
function parseCSV(text){
  var rows=[],row=[],field="",inQuotes=false,i,c;
  for(i=0;i<text.length;i++){
    c=text[i];
    if (inQuotes){
      if (c === '"'){ if (text[i+1] === '"'){ field+='"'; i++; } else { inQuotes=false; } }
      else { field+=c; }
    } else {
      if (c === '"') inQuotes=true;
      else if (c === ","){ row.push(field); field=""; }
      else if (c === "\n"){ row.push(field); rows.push(row); row=[]; field=""; }
      else if (c === "\r"){ }
      else { field+=c; }
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}
function loadViaCSV(publishedUrl){
  var csvUrl = normalizeToCSV(publishedUrl);
  return fetch(csvUrl,{cache:"no-store"})
    .then(function(resp){ if(!resp.ok) throw new Error("HTTP "+resp.status); return resp.text(); })
    .then(function(text){ var rows=parseCSV(text); if(!rows.length) throw new Error("Empty CSV"); return rows; });
}
function loadViaGvizJSONP(publishedUrl,timeoutMs){
  timeoutMs = timeoutMs || 8000;
  return new Promise(function(resolve,reject){
    try{
      var base = publishedUrl.replace(/\/pubhtml(\?.*)?$/,"");
      if (!/\/gviz\/tq/.test(base)){
        base = base.replace(/\/edit(\?.*)?$/,"");
        if (base.charAt(base.length-1)==="/") base = base.slice(0,-1);
        base += "/gviz/tq";
      }
      var m = /gid=([0-9]+)/.exec(publishedUrl);
      var gid = m ? m[1] : "";
      var gvizUrl = base + "?tqx=out:json" + (gid ? "&gid="+gid : "");

      var cbName = "gviz_cb_" + Math.random().toString(36).slice(2);
      var timer = setTimeout(function(){ cleanup(); reject(new Error("GViz timeout")); }, timeoutMs);
      function cleanup(){ clearTimeout(timer); if(script && script.parentNode) script.parentNode.removeChild(script); try{ delete window[cbName]; }catch(_){ window[cbName]=undefined; } }

      window[cbName] = function(response){
        cleanup();
        try{
          if (!response || !response.table) throw new Error("No table");
          var cols = response.table.cols.map(function(c){ return (c && c.label ? String(c.label).trim().toLowerCase() : ""); });
          var rows = [cols];
          response.table.rows.forEach(function(r){
            var vals = r.c.map(function(c){ return (c && c.v != null ? String(c.v) : ""); });
            rows.push(vals);
          });
          resolve(rows);
        }catch(e){ reject(e); }
      };

      var script = document.createElement("script");
      script.src = gvizUrl + "&tq&" + (gid ? "gid="+gid+"&" : "") + "tqx=out:json&callback=" + cbName;
      script.async = true;
      script.onerror = function(){ cleanup(); reject(new Error("GViz script error")); };
      document.head.appendChild(script);
    }catch(e){ reject(e); }
  });
}
function normalizeDateYMD(s){
  s = String(s||"").trim();
  if (!s) return "";
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return m[1] + "-" + m[2].padStart(2,"0") + "-" + m[3].padStart(2,"0");
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return m[3] + "-" + m[2].padStart(2,"0") + "-" + m[1].padStart(2,"0");
  var t = Date.parse(s);
  if (!isNaN(t)){
    var d = new Date(t);
    var parts = new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
    var y="",m2="",d2="";
    for (var i=0;i<parts.length;i++){
      if (parts[i].type==="year") y=parts[i].value;
      else if (parts[i].type==="month") m2=parts[i].value;
      else if (parts[i].type==="day") d2=parts[i].value;
    }
    return y+"-"+m2+"-"+d2;
  }
  return "";
}
function rowsToQA(rows){
  var header = rows[0].map(function(h){ return String(h||"").trim().toLowerCase(); });
  var di = header.indexOf("date");
  var qi = header.indexOf("question"), ai = header.indexOf("answer"), si = header.indexOf("score"), li = header.indexOf("aliases");
  if (qi<0 || ai<0 || si<0) throw new Error("Missing required headers");
  var byKey = new Map();
  rows.slice(1).forEach(function(row){
    if (!row || !row.length) return;
    var dt = di>=0 ? normalizeDateYMD(row[di]) : "";
    var q  = (row[qi]||"").trim();
    var a  = (row[ai]||"").trim();
    var sText = String(row[si]==null ? "" : row[si]).trim();
    var sNum  = Number(sText.replace(/[^0-9.+-]/g,""));
    var l     = li>=0 ? (row[li]||"") : "";
    if (!q || !a) return;
    var key = (dt||"") + "||" + q;
    if (!byKey.has(key)) byKey.set(key, { date: dt, question: q, answers: [] });
    byKey.get(key).answers.push({
      text:a,
      score: isFinite(sNum)?sNum:0,
      aliases: l.split(/[\|,]/).map(function(x){return x.trim();}).filter(function(x){return !!x;})
    });
  });
  var out = [];
  byKey.forEach(function(block){
    block.answers.sort(function(x,y){ return y.score - x.score; });
    out.push(block);
  });
  if (!out.length) throw new Error("Parsed 0 questions");
  return out;
}
function loadQuestions(){
  return loadViaCSV(SHEET_PUBLISHED_URL)
    .then(function(rows){ var out = rowsToQA(rows); console.log("Loaded "+out.length+" questions via CSV"); return out; })
    .catch(function(csvErr){
      console.warn("CSV load failed, trying GViz JSONP...", csvErr);
      return loadViaGvizJSONP(SHEET_PUBLISHED_URL)
        .then(function(rows){ var out = rowsToQA(rows); console.log("Loaded "+out.length+" questions via GViz JSONP"); return out; })
        .catch(function(gvizErr){ console.warn("GViz load failed, using embedded QUESTIONS", gvizErr); return QUESTIONS; });
    });
}

// ===== init =====
(function init(){
  loadQuestions().then(function(data){
    if (data && data.length){
      if (data !== QUESTIONS){
        while (QUESTIONS.length) QUESTIONS.pop();
        data.forEach(function(q){ QUESTIONS.push(q); });
      }
    }

    DAY_KEY = getDayKey();

    // Prefer sheet-driven date if present
    var todays = (QUESTIONS || []).filter(function(q){ return (q.date || "") === DAY_KEY; });
    if (DAILY_MODE && todays.length){
      QUESTIONS = todays;
      idx = 0;
    } else if (DAILY_MODE){
      var qMap = buildQuestionMap();
      idx = pickIndexGlobal(qMap, DAY_KEY);
    } else {
      idx = 0;
    }

    startDailyTickerLondon();
    renderQuestion();
    renderStreakPill();
    renderBadgeRowForToday();
  }).catch(function(err){
    console.error("Init failed", err);
    startDailyTickerLondon();
    renderQuestion();
    renderStreakPill();
    renderBadgeRowForToday();
  });
})();

// ===== events =====
if (els.guessBtn) els.guessBtn.addEventListener("click", handleGuess);
if (els.input) els.input.addEventListener("keydown", function(e){ if (e.key === "Enter") handleGuess(); });
if (els.emailForm) els.emailForm.addEventListener("submit", handleEmailSubmit);

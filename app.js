// app.js — ASCII-only, no smart quotes, no backticks
"use strict";

// ===== sample fallback data =====
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
var idx = 0, score = 0, revealed = new Set(), strikes = 0;
var els = {
  questionText: document.getElementById("questionText"),
  board: document.getElementById("board"),
  input: document.getElementById("guessInput"),
  guessBtn: document.getElementById("guessBtn"),
  passBtn: document.getElementById("passBtn"),
  nextBtn: document.getElementById("nextBtn"),
  score: document.getElementById("score"),
  strike1: document.getElementById("strike1"),
  strike2: document.getElementById("strike2"),
  strike3: document.getElementById("strike3")
};

function norm(s){ return s.toLowerCase().replace(/[^a-z0-9\s-]/g,"").trim(); }

// ===== Daily Mode =====
const DAILY_MODE = true;          // set false to disable daily mode
const DAILY_TZ   = "Europe/London";
const MAX_ANSWERS = 5;            // 5 stacked tiles (Wordle-ish)
var DAY_KEY = null;

function getDayKey(){
  var now = new Date();
  var fmt = new Intl.DateTimeFormat("en-GB",{timeZone:DAILY_TZ,year:"numeric",month:"2-digit",day:"2-digit"});
  var parts = fmt.formatToParts(now);
  var y="",m="",d="";
  for (var i=0;i<parts.length;i++){
    if (parts[i].type==="year") y=parts[i].value;
    else if (parts[i].type==="month") m=parts[i].value;
    else if (parts[i].type==="day") d=parts[i].value;
  }
  return y+"-"+m+"-"+d;
}

function finishRound(){
  if (DAILY_MODE){
    els.input.disabled = true; els.guessBtn.disabled = true;
    els.passBtn.classList.add("hidden"); els.nextBtn.classList.add("hidden");
    try{ localStorage.setItem("played-"+DAY_KEY,"1"); }catch(_){}
    var q = QUESTIONS[idx];
    els.questionText.textContent = q.question + " - All answers revealed! Come back tomorrow.";
  } else {
    els.nextBtn.classList.remove("hidden");
  }
}

// ----- No-repeat engine (auto-resets when the question set changes) -----
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
function poolSignature(map){
  var ids = map.map(function(x){ return x.id; });
  return ids.join("|");
}
function getSeasonAnchor(todayKey, sig){
  var savedSig = null, savedAnchor = null;
  try {
    savedSig   = localStorage.getItem("ff_pool_sig");
    savedAnchor= localStorage.getItem("ff_anchor");
  } catch(e){}
  if (savedSig !== sig){
    try { localStorage.setItem("ff_pool_sig", sig); localStorage.setItem("ff_anchor", todayKey); } catch(e){}
    return todayKey;
  }
  if (!savedAnchor){
    try { localStorage.setItem("ff_anchor", todayKey); } catch(e){}
    return todayKey;
  }
  return savedAnchor;
}
function pickIndexNoRepeat(map, todayKey, anchorKey){
  var total = map.length;
  if (!total) return 0;
  var offset = daysSince(anchorKey, todayKey);
  var pos = ((offset % total) + total) % total;
  return map[pos].idx;
}

// ===== UI =====
function renderQuestion(){
  var q = QUESTIONS[idx];
  els.questionText.textContent = q.question;
  els.board.innerHTML = "";
  revealed = new Set();
  strikes = 0; updateStrikes();
  els.nextBtn.classList.add("hidden");
  els.input.disabled = false; els.guessBtn.disabled = false;
  els.input.value = ""; try{ els.input.focus(); }catch(_){}
  els.score.textContent = "0%"; // reset HUD score

  var count = Math.min(q.answers.length, MAX_ANSWERS);
  for (var i=0;i<count;i++){
    var tile = document.createElement("div");
    tile.className = "tile";
    tile.setAttribute("data-index", String(i));
    // include .fill layer for the left->right reveal
    tile.innerHTML = '<div class="fill"></div><div class="tile-content"><span class="answer">— — —</span><span class="points">??</span></div>';
    els.board.appendChild(tile);
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
      els.score.textContent = score + "%";
    }
    fill.removeEventListener("transitionend", onDone);

    // End-of-round check
    var totalToReveal = Math.min(q.answers.length, els.board.children.length);
    if (revealed.size >= totalToReveal) finishRound();
  };

  fill.addEventListener("transitionend", onDone);
  // Kick the animation next frame
  requestAnimationFrame(function(){ fill.style.width = ans.score + "%"; });
}

function updateStrikes(){
  [els.strike1,els.strike2,els.strike3].forEach(function(el,i){
    el.style.opacity = (strikes > i ? 1 : 0.25);
  });
}

function handleGuess(){
  var guess = norm(els.input.value); if (!guess) return;
  var q = QUESTIONS[idx], foundIndex = -1;
  q.answers.forEach(function(ans,i){
    if (foundIndex !== -1) return;
    if (revealed.has(i)) return;
    var candidates = [ans.text].concat(ans.aliases||[]).map(norm);
    if (candidates.indexOf(guess) !== -1) foundIndex = i;
  });
  if (foundIndex !== -1){
    reveal(foundIndex); els.input.value = ""; try{ els.input.focus(); }catch(_){}
  } else {
    strikes = Math.min(strikes+1,3); updateStrikes();
    if (strikes >= 3){
      q.answers.forEach(function(_,i){ if (!revealed.has(i)) reveal(i); });
      finishRound();
    }
  }
}

function nextQuestion(){ idx = (idx+1) % QUESTIONS.length; renderQuestion(); }
els.guessBtn.addEventListener("click", handleGuess);
els.input.addEventListener("keydown", function(e){ if (e.key === "Enter") handleGuess(); });
els.passBtn.addEventListener("click", nextQuestion);
els.nextBtn.addEventListener("click", nextQuestion);

// ===== Google Sheets loader (CSV first, GViz JSONP fallback) =====
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
          var qi = cols.indexOf("question"), ai = cols.indexOf("answer"), si = cols.indexOf("score"), li = cols.indexOf("aliases");
          if (qi<0 || ai<0 || si<0) throw new Error("Missing headers");
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
function rowsToQA(rows){
  var header = rows[0].map(function(h){ return String(h||"").trim().toLowerCase(); });
  var qi = header.indexOf("question"), ai = header.indexOf("answer"), si = header.indexOf("score"), li = header.indexOf("aliases");
  if (qi<0 || ai<0 || si<0) throw new Error("Missing required headers");
  var byQ = new Map();
  rows.slice(1).forEach(function(row){
    if (!row || !row.length) return;
    var q = (row[qi]||"").trim();
    var a = (row[ai]||"").trim();
    var sText = String(row[si]==null ? "" : row[si]).trim();
    var sNum = Number(sText.replace(/[^0-9.+-]/g,""));
    var l = li>=0 ? (row[li]||"") : "";
    if (!q || !a) return;
    if (!byQ.has(q)) byQ.set(q, []);
    byQ.get(q).push({ text:a, score:isFinite(sNum)?sNum:0, aliases:l.split("|").map(function(x){return x.trim();}).filter(function(x){return !!x;}) });
  });
  var out = [];
  byQ.forEach(function(answers,question){ answers.sort(function(x,y){ return y.score - x.score; }); out.push({question:question, answers:answers}); });
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
      if (data !== QUESTIONS){ while (QUESTIONS.length) QUESTIONS.pop(); data.forEach(function(q){ QUESTIONS.push(q); }); }
    }
    if (DAILY_MODE){
      DAY_KEY = getDayKey();
      var qMap = buildQuestionMap();
      var sig  = poolSignature(qMap);
      var anchor = getSeasonAnchor(DAY_KEY, sig);
      idx = pickIndexNoRepeat(qMap, DAY_KEY, anchor);
      els.passBtn.classList.add("hidden");
      els.nextBtn.classList.add("hidden");
    }
    renderQuestion();
  }).catch(function(err){
    console.error("Init failed", err);
    renderQuestion();
  });
})();

(function setDailyDate(){
  var el = document.getElementById("dailyDate");
  if (!el) return;
  var tz = (typeof DAILY_TZ === "string" && DAILY_TZ) ? DAILY_TZ : "Europe/London";
  var now = new Date();
  var fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "numeric", month: "short", year: "numeric"
  });
  el.textContent = "Daily · " + fmt.format(now) + " · Europe/London";
})();

// A dependency-free HTML page served at "/" by both serve() and serveMachine() -- a full-screen
// admin tool for running crew from a plain browser, not just from inside Obsidian. Started
// read-only; now also approves/rejects review items and answers questions via the same /cmd
// endpoint Wrangler uses, so it's a second place actions happen, not just a viewer.
// Styled as a ToolwrightTheme "app page" (~/Desktop/Guides/ToolwrightTheme.html's #app section,
// backed by the reference Toolwright-index.html shell): always dark, no prefers-color-scheme
// toggle -- unlike a doc page (read in whatever light the reader is already in), an app page is
// operated, so it's one deliberate dark surface, not two. Real Archivo + JetBrains Mono (no
// Merriweather -- app pages don't use the doc palette's serif, only doc pages do), the translucent
// blurred sticky rail, and the app-scale hero type. No build step: static markup and vanilla JS,
// same as commands.ts's HELP text is a plain string. All dynamic content is set via textContent,
// never innerHTML, since project ids, paths, agent names and event data ultimately come from
// user-controlled folder/file names and content.
export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>crew</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  /* ---- app-page palette, fixed -- see ToolwrightTheme.html#app ---- */
  :root {
    --void:#000000; --panel:#0b0d0f; --raise:#121519; --line:#1d2228; --line-hot:#2b333c;
    --text:#e9ecef; --dim:#767f89; --dimmer:#4b545d; --user:#4dd2ff; --ai:#ffb547;
    --ok:#7fd39b; --warn:#ffb547; --bad:#ff7a7a;
    --font-sans:'Archivo',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    --font-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --gap-xs:6px; --gap-sm:10px; --gap-md:18px; --gap-lg:28px; --gap-xl:48px; --radius:6px;
    --gutter:40px;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  html, body { height:100%; }
  body { background:var(--void); color:var(--text); font-family:var(--font-sans); font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased; }
  a { color:var(--user); text-decoration:none; }
  code { font-family:var(--font-mono); background:var(--panel); padding:2px 5px; border-radius:4px; border:1px solid var(--line); color:var(--text); font-size:.9em; }
  :focus-visible { outline:2px solid var(--user); outline-offset:3px; }

  /* ---- rail: sticky, translucent, blurred -- edge-to-edge chrome over scrolling content ---- */
  #shell { min-height:100%; display:flex; flex-direction:column; }
  .rail { position:sticky; top:0; z-index:20; background:rgba(0,0,0,.86); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); }
  .rail-inner { padding:0 var(--gutter); display:flex; align-items:center; gap:24px; height:52px; }
  .brand { font-weight:700; letter-spacing:-0.02em; font-size:15px; color:var(--text); }
  .brand span { color:var(--dimmer); font-weight:400; }
  .rail-meta { margin-left:auto; display:flex; align-items:center; gap:var(--gap-sm); font-size:12.5px; color:var(--dim); font-family:var(--font-mono); }
  .rail-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--ok); }

  .hero { padding:var(--gap-xl) var(--gutter) var(--gap-lg); border-bottom:1px solid var(--line); }
  .hero h1 { font-family:var(--font-sans); font-size:clamp(30px,5vw,56px); line-height:.98; letter-spacing:-0.035em; font-weight:700; color:var(--text); margin-bottom:var(--gap-sm); }
  .lede { font-family:var(--font-sans); font-size:16px; line-height:1.6; color:var(--dim); max-width:70ch; }
  .back { display:inline-block; margin-bottom:var(--gap-sm); font-size:13px; color:var(--user); cursor:pointer; }
  .back:hover { text-decoration:underline; }

  .main { flex:1; padding:var(--gap-xl) var(--gutter); }
  #gate { max-width:420px; margin:10vh auto 0; text-align:center; }
  #gate p { color:var(--dim); font-size:15px; line-height:1.6; margin-bottom:var(--gap-md); }
  #gate input { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:var(--radius); background:var(--panel); color:var(--text); font-family:var(--font-mono); font-size:13px; margin-bottom:var(--gap-md); }
  #gate button { padding:9px 16px; border-radius:var(--radius); border:1px solid var(--user); background:var(--user); color:#04121a; font-weight:600; font-size:14px; cursor:pointer; }
  #error { color:var(--bad); font-size:13px; margin-top:var(--gap-sm); min-height:1em; }

  .grid { display:grid; gap:var(--gap-md); grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:var(--gap-md); }
  .card.clickable { cursor:pointer; }
  .card.clickable:hover { border-color:var(--line-hot); }
  .card h2 { font-size:16px; font-weight:700; color:var(--text); display:flex; align-items:center; gap:var(--gap-xs); margin-bottom:2px; }
  .card h3 { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); font-weight:600; margin-bottom:var(--gap-sm); }
  .path { color:var(--dimmer); font-size:12px; font-family:var(--font-mono); margin-bottom:var(--gap-sm); word-break:break-all; }
  .summary { font-size:12.5px; color:var(--dim); margin-bottom:var(--gap-sm); }
  .summary .needs { color:var(--ai); }

  .pill { display:inline-flex; align-items:center; padding:2px 8px; border-radius:999px; font-size:10.5px; font-family:var(--font-mono); border:1px solid var(--line-hot); color:var(--dim); }
  .pill.ok { color:var(--ok); border-color:#1d3d2a; }
  .pill.warn, .pill.ai { color:var(--ai); border-color:#4a3a1c; }
  .pill.bad { color:var(--bad); border-color:#4a2020; }
  .pill.user { color:var(--user); border-color:#1d3d4c; }

  .row { display:flex; justify-content:space-between; align-items:center; font-size:13px; color:var(--dim); padding:7px 0; border-bottom:1px solid var(--line); }
  .row:last-child { border-bottom:none; }
  .row .name { color:var(--text); font-weight:600; }
  .row .meta { color:var(--dimmer); font-size:12px; margin-left:var(--gap-xs); }

  #empty { color:var(--dim); text-align:center; margin-top:15vh; font-size:16px; }
  footer { border-top:1px solid var(--line); padding:var(--gap-md) var(--gutter); color:var(--dimmer); font-size:12px; }

  .detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:var(--gap-md); margin-bottom:var(--gap-md); }
  @media (max-width:760px) { .detail-grid { grid-template-columns:1fr; } }
  .hbar-row { display:grid; grid-template-columns:100px 1fr 56px; align-items:center; gap:var(--gap-sm); margin-bottom:9px; font-size:12.5px; }
  .hbar-row span:first-child { color:var(--text); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .hbar-row span:last-child { text-align:right; color:var(--dim); font-family:var(--font-mono); }
  .track { height:8px; border-radius:4px; background:var(--raise); overflow:hidden; }
  .track i { display:block; height:100%; border-radius:4px; }
  .terminal { background:var(--raise); border:1px solid var(--line); border-radius:var(--radius); padding:var(--gap-sm) var(--gap-md); font-family:var(--font-mono); font-size:11.5px; line-height:1.85; max-height:360px; overflow:auto; }
  .terminal .line { white-space:pre-wrap; word-break:break-word; margin-bottom:2px; }
  .terminal .ts { color:var(--dimmer); }
  .terminal .ty { color:var(--user); }
  .terminal .ty.ok { color:var(--ok); }
  .terminal .ty.bad { color:var(--bad); }
  .terminal .by { color:var(--dim); }
  .terminal .empty { color:var(--dimmer); }

  .btn { padding:6px 12px; border-radius:var(--radius); border:1px solid var(--line-hot); background:var(--raise); color:var(--text); font-size:12.5px; font-family:var(--font-sans); cursor:pointer; }
  .btn:hover { border-color:var(--user); }
  .btn.primary { border-color:var(--user); color:var(--user); }
  .btn.danger { border-color:#4a2020; color:var(--bad); }
  .actions { margin-top:var(--gap-sm); display:flex; gap:6px; flex-wrap:wrap; }
  .reply-box { margin-top:var(--gap-sm); }
  .reply-box textarea { width:100%; min-height:60px; background:var(--void); border:1px solid var(--line); border-radius:var(--radius); color:var(--text); font-family:var(--font-sans); font-size:13px; padding:8px; resize:vertical; }

  .review-item { border-bottom:1px solid var(--line); padding:var(--gap-sm) 0; }
  .review-item:last-child { border-bottom:none; }
  .review-item .title { font-weight:600; color:var(--text); font-size:13.5px; margin-bottom:2px; }
  .review-item .meta { color:var(--dimmer); font-size:11.5px; margin-bottom:6px; }
  .review-item .body { color:var(--dim); font-size:12.5px; white-space:pre-wrap; margin-bottom:6px; max-height:140px; overflow:auto; }

  .task-row { display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid var(--line); font-size:13px; }
  .task-row:last-child { border-bottom:none; }
  .task-row .bar { width:4px; height:16px; border-radius:2px; flex:0 0 auto; }
  .task-row .tid { color:var(--dimmer); font-family:var(--font-mono); font-size:11.5px; flex:0 0 56px; }
  .task-row .ttitle { color:var(--text); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .task-row .towner { color:var(--dim); font-size:11.5px; flex:0 0 auto; }
  .task-summary { font-size:12.5px; color:var(--dim); margin-bottom:var(--gap-sm); }

  @media (max-width:640px) { :root { --gutter:16px; } }
</style>
</head>
<body>
<div id="shell">
  <header class="rail">
    <div class="rail-inner">
      <div class="brand">crew<span> admin</span></div>
      <div class="rail-meta" id="railMeta"><span class="rail-dot"></span><span id="railMetaText">connecting…</span></div>
    </div>
  </header>

  <div class="hero">
    <div id="heroBack"></div>
    <h1 id="heroTitle">crew</h1>
    <p class="lede" id="heroLede">Loading…</p>
  </div>

  <main class="main">
    <div id="gate" style="display:none">
      <p>Paste this machine's API token to view the dashboard (from <code>crew/crew.md</code> or <code>~/.crew/crew.md</code>, or Wrangler's "Copy API token" button).</p>
      <input id="tok" type="password" placeholder="token" autocomplete="off">
      <button id="go">Open dashboard</button>
      <div id="error"></div>
    </div>
    <div id="app" style="display:none">
      <div id="empty" style="display:none">No registered projects. Run <code>crew init</code> or <code>crew migrate &lt;path&gt;</code>.</div>
      <div class="grid" id="grid"></div>
      <div id="detail" style="display:none"></div>
    </div>
  </main>

  <footer>Refreshes every 5s. Approve, reject and answer here, or in Wrangler -- both write through the same crew.</footer>
</div>
<script>
(function () {
  var qs = new URLSearchParams(location.search);
  var token = qs.get("token") || localStorage.getItem("crewToken") || "";
  var gate = document.getElementById("gate"), app = document.getElementById("app");
  var BAR_COLORS = ["#4dd2ff", "#ffb547", "#a882d6", "#7fd39b", "#ff7a7a", "#5aa9c9"];
  var STATE_PILL = { running: "ok", sleeping: "user", idle: "", blocked: "bad", disabled: "" };
  var STATUS_COLOR = { inbox: "#4b545d", ready: "#4dd2ff", claimed: "#5aa9c9", verify: "#a882d6", review: "#ffb547", done: "#7fd39b", blocked: "#ff7a7a" };

  var mode = null, lastProjects = [], lastStatuses = {}, selected = null;

  function projPath(id, suffix) {
    return mode === "machine" ? "/p/" + encodeURIComponent(id) + suffix : suffix;
  }

  function cmd(argv) {
    var body = { argv: argv, as: "human" };
    if (mode === "machine" && selected) body.project = selected;
    return fetch("/cmd", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (r.status === 401) throw new Error("unauthorized");
      return r.json();
    }).then(function (res) {
      if (res.code !== 0) throw new Error(res.out || "command failed");
      return res;
    });
  }

  // Reveals a textarea + submit/cancel under host; onSubmit(text) runs on submit, then
  // renderDetail() refreshes the whole card set so the acted-on item disappears.
  function withReply(host, placeholder, submitLabel, onSubmit) {
    if (host.querySelector(".reply-box")) return;
    var box = document.createElement("div"); box.className = "reply-box";
    var ta = document.createElement("textarea"); ta.placeholder = placeholder;
    box.appendChild(ta);
    var actions = document.createElement("div"); actions.className = "actions";
    var submit = document.createElement("button"); submit.className = "btn primary"; submit.textContent = submitLabel;
    submit.onclick = function () {
      var v = ta.value.trim();
      if (!v) return;
      submit.disabled = true; submit.textContent = "\\u2026";
      onSubmit(v).then(function () { renderDetail(); }).catch(function (e) {
        submit.disabled = false; submit.textContent = submitLabel;
        box.appendChild(errorLine(e.message));
      });
    };
    var cancel = document.createElement("button"); cancel.className = "btn"; cancel.textContent = "Cancel";
    cancel.onclick = function () { box.remove(); };
    actions.appendChild(submit); actions.appendChild(cancel);
    box.appendChild(actions);
    host.appendChild(box);
    ta.focus();
  }

  function errorLine(msg) {
    var e = document.createElement("div"); e.style.color = "var(--bad)"; e.style.fontSize = "12px"; e.style.marginTop = "6px"; e.textContent = msg;
    return e;
  }

  function showGate(msg) {
    gate.style.display = "block"; app.style.display = "none";
    document.getElementById("heroTitle").textContent = "crew";
    document.getElementById("heroLede").textContent = "Sign in to view status.";
    document.getElementById("heroBack").innerHTML = "";
    document.getElementById("error").textContent = msg || "";
  }
  document.getElementById("go").onclick = function () {
    token = document.getElementById("tok").value.trim();
    if (!token) return;
    localStorage.setItem("crewToken", token);
    boot();
  };

  function api(path) {
    return fetch(path, { headers: { Authorization: "Bearer " + token } }).then(function (r) {
      if (r.status === 401) throw new Error("unauthorized");
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }

  function pill(text, cls) {
    var p = document.createElement("span"); p.className = "pill " + (cls || ""); p.textContent = text;
    return p;
  }

  function agentRow(a) {
    var row = document.createElement("div"); row.className = "row";
    var left = document.createElement("span");
    var name = document.createElement("span"); name.className = "name"; name.textContent = a.name;
    left.appendChild(name);
    var meta = document.createElement("span"); meta.className = "meta"; meta.textContent = a.runner + "/" + (a.model || "-");
    left.appendChild(meta);
    row.appendChild(left);
    var right = document.createElement("span");
    right.appendChild(pill(a.state, STATE_PILL[a.state]));
    right.appendChild(document.createTextNode(" $" + a.spend.toFixed(2)));
    row.appendChild(right);
    return row;
  }

  function overviewCard(p, s) {
    var el = document.createElement("div"); el.className = "card clickable";
    el.onclick = function () { selected = p.id; renderCurrent(); };
    var h = document.createElement("h2");
    h.appendChild(document.createTextNode(p.id));
    h.appendChild(pill(p.status, p.status === "active" ? "ok" : "warn"));
    el.appendChild(h);
    var path = document.createElement("div"); path.className = "path"; path.textContent = p.path + (p.missing ? "  (missing)" : ""); el.appendChild(path);
    if (s) {
      var running = s.agents.filter(function (a) { return a.state === "running"; }).length;
      var sleeping = s.agents.filter(function (a) { return a.state === "sleeping"; }).length;
      var needs = (s.review || 0) + (s.questions || 0) + ((s.tasks && s.tasks.blocked) || 0);
      var sum = document.createElement("div"); sum.className = "summary";
      sum.textContent = running + " running, " + sleeping + " sleeping, ";
      var needsSpan = document.createElement("span"); needsSpan.className = "needs"; needsSpan.textContent = needs + " needs you";
      sum.appendChild(needsSpan);
      sum.appendChild(document.createTextNode(", $" + s.spend.toFixed(2) + " today"));
      el.appendChild(sum);
      s.agents.forEach(function (a) { el.appendChild(agentRow(a)); });
    }
    return el;
  }

  function renderOverview() {
    document.getElementById("detail").style.display = "none";
    document.getElementById("heroBack").innerHTML = "";
    document.getElementById("heroTitle").textContent = "crew";
    document.getElementById("heroLede").textContent = mode === "machine"
      ? lastProjects.length + " registered project" + (lastProjects.length === 1 ? "" : "s") + " on this machine."
      : "A single project, running standalone (v0 mode).";
    var grid = document.getElementById("grid");
    grid.style.display = "grid";
    grid.innerHTML = "";
    document.getElementById("empty").style.display = lastProjects.length ? "none" : "block";
    lastProjects.forEach(function (p) { grid.appendChild(overviewCard(p, lastStatuses[p.id])); });
  }

  function hbar(label, value, max, valueText, color) {
    var row = document.createElement("div"); row.className = "hbar-row";
    var name = document.createElement("span"); name.textContent = label; row.appendChild(name);
    var track = document.createElement("div"); track.className = "track";
    var i = document.createElement("i"); i.style.width = (max > 0 ? Math.max(3, (value / max) * 100) : 0) + "%"; i.style.background = color;
    track.appendChild(i); row.appendChild(track);
    var val = document.createElement("span"); val.textContent = valueText; row.appendChild(val);
    return row;
  }

  function taskRow(t) {
    var row = document.createElement("div"); row.className = "task-row";
    var bar = document.createElement("span"); bar.className = "bar"; bar.style.background = STATUS_COLOR[t.status] || "var(--line-hot)";
    row.appendChild(bar);
    var tid = document.createElement("span"); tid.className = "tid"; tid.textContent = t.id;
    row.appendChild(tid);
    var title = document.createElement("span"); title.className = "ttitle"; title.textContent = t.title;
    row.appendChild(title);
    var owner = document.createElement("span"); owner.className = "towner"; owner.textContent = t.claimed_by || t.worker || t.status;
    row.appendChild(owner);
    return row;
  }

  function reviewTaskItem(t) {
    var el = document.createElement("div"); el.className = "review-item";
    var title = document.createElement("div"); title.className = "title"; title.textContent = t.id + "  " + t.title;
    el.appendChild(title);
    var kind = t.status === "review" ? "Escalated" + (t.recommendation ? ", verifier recommends " + t.recommendation : "") : "Sampled auto-approval: do you agree?";
    var meta = document.createElement("div"); meta.className = "meta"; meta.textContent = kind + ". Worker: " + (t.worker || "unknown") + ".";
    el.appendChild(meta);
    var last = (t.notes || "").split("\\n").filter(Boolean).slice(-3).join("\\n");
    if (last) { var body = document.createElement("div"); body.className = "body"; body.textContent = last; el.appendChild(body); }
    var actions = document.createElement("div"); actions.className = "actions";
    var approveLabel = t.status === "review" ? "Approve" : "Agree";
    var rejectLabel = t.status === "review" ? "Reject" : "Disagree";
    var approveVerb = t.status === "review" ? "approve" : "agree";
    var rejectVerb = t.status === "review" ? "reject" : "disagree";
    var approve = document.createElement("button"); approve.className = "btn primary"; approve.textContent = approveLabel;
    approve.onclick = function () {
      approve.disabled = true;
      cmd(["verdict", t.id, approveVerb]).then(function () { renderDetail(); }).catch(function (e) { approve.disabled = false; el.appendChild(errorLine(e.message)); });
    };
    var reject = document.createElement("button"); reject.className = "btn danger"; reject.textContent = rejectLabel;
    reject.onclick = function () { withReply(el, "What needs fixing?", rejectLabel, function (reason) { return cmd(["verdict", t.id, rejectVerb, "--reason", reason]); }); };
    actions.appendChild(approve); actions.appendChild(reject);
    el.appendChild(actions);
    return el;
  }

  function reviewQuestionItem(q) {
    var el = document.createElement("div"); el.className = "review-item";
    var title = document.createElement("div"); title.className = "title"; title.textContent = q.id + "  " + q.topic;
    el.appendChild(title);
    var meta = document.createElement("div"); meta.className = "meta"; meta.textContent = q.agent + " is asking.";
    el.appendChild(meta);
    var body = document.createElement("div"); body.className = "body"; body.textContent = (q.body || "").replace(/^\\s*#.*\\n+/, "").trim();
    el.appendChild(body);
    var actions = document.createElement("div"); actions.className = "actions";
    var reply = document.createElement("button"); reply.className = "btn primary"; reply.textContent = "Reply";
    reply.onclick = function () { withReply(el, "Your answer\\u2026", "Send", function (answer) { return cmd(["question", "answer", q.id, answer]); }); };
    actions.appendChild(reply);
    el.appendChild(actions);
    return el;
  }

  function eventLine(e) {
    var line = document.createElement("div"); line.className = "line";
    var bad = /fail|error|reject|blocked|anomaly|expired|uncoverable/.test(e.type);
    var ok = /succeeded|approved|done|answered|resumed/.test(e.type);
    var ts = document.createElement("span"); ts.className = "ts"; ts.textContent = (e.ts || "").slice(11, 19) + " ";
    var ty = document.createElement("span"); ty.className = "ty " + (bad ? "bad" : ok ? "ok" : ""); ty.textContent = e.type;
    var by = document.createElement("span"); by.className = "by"; by.textContent = "  " + e.by + (e.task ? " " + e.task : "");
    line.appendChild(ts); line.appendChild(ty); line.appendChild(by);
    return line;
  }

  function renderDetail() {
    var p = lastProjects.filter(function (x) { return x.id === selected; })[0];
    if (!p) { selected = null; return renderOverview(); }
    var s = lastStatuses[p.id];
    document.getElementById("grid").style.display = "none";

    var back = document.createElement("div"); back.className = "back"; back.textContent = "\\u2190 All projects";
    back.onclick = function () { selected = null; renderCurrent(); };
    var heroBack = document.getElementById("heroBack"); heroBack.innerHTML = ""; heroBack.appendChild(back);
    document.getElementById("heroTitle").textContent = p.id;
    document.getElementById("heroLede").textContent = p.path;

    var detail = document.getElementById("detail");
    detail.style.display = "block";
    detail.innerHTML = "";

    if (!s) { var none = document.createElement("p"); none.className = "lede"; none.textContent = "No status yet."; detail.appendChild(none); return; }

    var grid = document.createElement("div"); grid.className = "detail-grid";

    var spendCard = document.createElement("div"); spendCard.className = "card";
    var sh = document.createElement("h3"); sh.textContent = "Spend by agent — $" + s.spend.toFixed(2); spendCard.appendChild(sh);
    var maxSpend = Math.max.apply(null, s.agents.map(function (a) { return a.spend; }).concat([0.01]));
    s.agents.slice().sort(function (a, b) { return b.spend - a.spend; }).forEach(function (a, i) {
      spendCard.appendChild(hbar(a.name, a.spend, maxSpend, "$" + a.spend.toFixed(2), BAR_COLORS[i % BAR_COLORS.length]));
    });
    grid.appendChild(spendCard);

    var taskCard = document.createElement("div"); taskCard.className = "card";
    var th = document.createElement("h3"); th.textContent = "Tasks"; taskCard.appendChild(th);
    var order = ["inbox", "ready", "claimed", "verify", "review", "done", "blocked"];
    var counts = order.map(function (k) { return (s.tasks && s.tasks[k]) || 0; });
    if (!counts.some(function (c) { return c > 0; })) {
      var noTasks = document.createElement("p"); noTasks.style.color = "var(--dimmer)"; noTasks.style.fontSize = "13px"; noTasks.textContent = "No tasks.";
      taskCard.appendChild(noTasks);
    } else {
      var sumLine = document.createElement("div"); sumLine.className = "task-summary";
      var parts = [];
      order.forEach(function (k, i) { if (counts[i] > 0) parts.push(counts[i] + " " + k); });
      sumLine.textContent = parts.join(", ");
      taskCard.appendChild(sumLine);
      var list = document.createElement("div"); list.textContent = "loading\\u2026";
      taskCard.appendChild(list);
      api(projPath(p.id, "/tasks")).then(function (tasks) {
        list.innerHTML = "";
        tasks.slice().sort(function (a, b) { return order.indexOf(a.status) - order.indexOf(b.status); }).forEach(function (t) { list.appendChild(taskRow(t)); });
      }).catch(function () { list.textContent = "Couldn't load tasks."; });
    }
    grid.appendChild(taskCard);
    detail.appendChild(grid);

    var reviewCard = document.createElement("div"); reviewCard.className = "card"; reviewCard.style.marginBottom = "18px";
    var rh = document.createElement("h3"); rh.textContent = "Needs you"; reviewCard.appendChild(rh);
    var reviewBody = document.createElement("div"); reviewBody.textContent = "loading\\u2026";
    reviewCard.appendChild(reviewBody);
    detail.appendChild(reviewCard);
    Promise.all([api(projPath(p.id, "/review")), api(projPath(p.id, "/questions"))]).then(function (r) {
      reviewBody.innerHTML = "";
      var tasks = r[0], questions = r[1];
      if (!tasks.length && !questions.length) {
        var none2 = document.createElement("p"); none2.style.color = "var(--dimmer)"; none2.style.fontSize = "13px"; none2.textContent = "Nothing needs you right now.";
        reviewBody.appendChild(none2);
        return;
      }
      questions.forEach(function (q) { reviewBody.appendChild(reviewQuestionItem(q)); });
      tasks.forEach(function (t) { reviewBody.appendChild(reviewTaskItem(t)); });
    }).catch(function () { reviewBody.textContent = "Couldn't load review items."; });

    var agentsCard = document.createElement("div"); agentsCard.className = "card"; agentsCard.style.marginBottom = "18px";
    var ah = document.createElement("h3"); ah.textContent = "Agents"; agentsCard.appendChild(ah);
    s.agents.forEach(function (a) {
      agentsCard.appendChild(agentRow(a));
      if (a.lastLog) {
        var log = document.createElement("div"); log.style.fontFamily = "var(--font-mono)"; log.style.fontSize = "11px"; log.style.color = "var(--dimmer)"; log.style.padding = "0 0 8px";
        log.textContent = a.lastLog.slice(0, 100);
        agentsCard.appendChild(log);
      }
    });
    detail.appendChild(agentsCard);

    var evCard = document.createElement("div"); evCard.className = "card";
    var eh = document.createElement("h3"); eh.textContent = "Recent events"; evCard.appendChild(eh);
    var term = document.createElement("div"); term.className = "terminal";
    term.textContent = "loading...";
    evCard.appendChild(term);
    detail.appendChild(evCard);
    api(projPath(p.id, "/events?limit=40")).then(function (evs) {
      term.innerHTML = "";
      if (!evs.length) { var e = document.createElement("div"); e.className = "empty"; e.textContent = "No events yet."; term.appendChild(e); return; }
      evs.slice().reverse().forEach(function (e) { term.appendChild(eventLine(e)); });
    }).catch(function () {
      term.textContent = "Couldn't load events.";
    });
  }

  function renderCurrent() {
    if (selected) renderDetail(); else renderOverview();
  }

  function tick() {
    api("/health").then(function (health) {
      if (health.projects !== undefined) {
        mode = "machine";
        document.getElementById("railMetaText").textContent = "machine service \\u00b7 " + health.projects + " project" + (health.projects === 1 ? "" : "s");
        return Promise.all([api("/projects"), api("/status")]).then(function (r) {
          lastProjects = r[0]; lastStatuses = r[1];
        });
      }
      mode = "v0";
      document.getElementById("railMetaText").textContent = "standalone (v0)";
      return api("/status").then(function (s) {
        var id = (health.vault || "").split("/").pop() || "project";
        lastProjects = [{ id: id, path: health.vault, status: "active", missing: false }];
        lastStatuses = {}; lastStatuses[id] = s;
      });
    }).then(function () {
      gate.style.display = "none"; app.style.display = "block";
      renderCurrent();
    }).catch(function (e) {
      if (String(e.message) === "unauthorized") { localStorage.removeItem("crewToken"); showGate("Wrong token."); }
      else showGate("Couldn't reach crew: " + e.message);
    });
  }

  function boot() {
    tick();
    clearInterval(window.__crewTimer);
    window.__crewTimer = setInterval(tick, 5000);
  }

  if (!token) showGate(); else boot();
})();
</script>
</body>
</html>
`;

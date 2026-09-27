// A read-only, dependency-free HTML page served at "/" by both serve() and serveMachine() -- a
// dashboard for glancing at crew from a plain browser, not just from inside Obsidian. No build
// step: it's static markup and vanilla JS, exactly like commands.ts's HELP text is a plain
// string. All dynamic content is set via textContent, never innerHTML, since project ids, paths,
// agent names and event data ultimately come from user-controlled folder/file names and content.
export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>crew</title>
<style>
  :root { --bg:#f8f9fb; --surface:#fff; --surface-2:#f3f5f7; --fg:#111827; --fg-strong:#030712; --muted:#4b5563; --faint:#9ca3af; --line:#e2e5e9; --border:#d1d5db; --accent:#0ea5e9; --ok:#16a34a; --warn:#d97706; --bad:#dc2626; --font-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; --font-mono:ui-monospace,"JetBrains Mono",SFMono-Regular,Menlo,Consolas,monospace; --radius:6px; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#050505; --surface:#0b0d0f; --surface-2:#121519; --fg:#e9ecef; --fg-strong:#fff; --muted:#767f89; --faint:#4b545d; --line:#1d2228; --border:#1d2228; --accent:#4dd2ff; --ok:#7fd39b; --warn:#ffb547; --bad:#ff7a7a; }
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--fg); font-family:var(--font-sans); font-size:15px; line-height:1.5; padding:24px; }
  h1 { font-size:20px; font-weight:700; color:var(--fg-strong); margin-bottom:4px; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:20px; }
  code { font-family:var(--font-mono); background:var(--surface-2); padding:2px 5px; border-radius:4px; font-size:0.9em; }
  #gate { max-width:420px; margin:80px auto; text-align:center; }
  #gate input { width:100%; padding:9px 12px; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); color:var(--fg); font-family:var(--font-mono); font-size:13px; margin:12px 0; }
  #gate button { padding:8px 14px; border-radius:var(--radius); border:1px solid var(--accent); background:var(--accent); color:#04121a; font-weight:600; font-size:13px; cursor:pointer; }
  #gate p { color:var(--muted); font-size:13px; }
  #error { color:var(--bad); font-size:13px; margin-top:10px; min-height:1em; }
  .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px; }
  .card.clickable { cursor:pointer; }
  .card.clickable:hover { border-color:var(--accent); }
  .card h2 { font-size:15px; font-weight:700; color:var(--fg-strong); margin-bottom:2px; }
  .card h3 { font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--muted); margin-bottom:10px; }
  .pill { display:inline-flex; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; margin-left:6px; }
  .pill.active { background:rgba(22,163,74,.12); color:var(--ok); }
  .pill.paused { background:rgba(217,119,6,.12); color:var(--warn); }
  .path { color:var(--faint); font-size:12px; font-family:var(--font-mono); margin-bottom:10px; word-break:break-all; }
  .row { display:flex; justify-content:space-between; font-size:13px; color:var(--muted); padding:6px 0; border-bottom:1px solid var(--line); }
  .row:last-child { border-bottom:none; }
  .row .name { color:var(--fg); font-weight:600; }
  .dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; }
  .dot.running { background:var(--ok); }
  .dot.sleeping { background:var(--accent); opacity:.6; }
  .dot.idle { background:var(--faint); }
  .dot.blocked { background:var(--bad); }
  .dot.disabled { background:var(--faint); opacity:.4; }
  .summary { font-size:12.5px; color:var(--muted); margin-bottom:10px; }
  #empty { color:var(--muted); text-align:center; margin-top:60px; }
  footer { color:var(--faint); font-size:12px; margin-top:28px; }
  .back { display:inline-block; margin-bottom:14px; font-size:13px; color:var(--accent); cursor:pointer; }
  .back:hover { text-decoration:underline; }
  .detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
  @media (max-width:760px) { .detail-grid { grid-template-columns:1fr; } }
  .hbar-row { display:grid; grid-template-columns:90px 1fr 56px; align-items:center; gap:10px; margin-bottom:9px; font-size:12.5px; }
  .hbar-row span:first-child { color:var(--fg); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .hbar-row span:last-child { text-align:right; color:var(--muted); font-family:var(--font-mono); }
  .track { height:8px; border-radius:4px; background:var(--surface-2); overflow:hidden; }
  .track i { display:block; height:100%; border-radius:4px; }
  .terminal { background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius); padding:12px 14px; font-family:var(--font-mono); font-size:11.5px; line-height:1.85; max-height:340px; overflow:auto; }
  .terminal .line { white-space:pre-wrap; word-break:break-word; margin-bottom:2px; }
  .terminal .ts { color:var(--faint); }
  .terminal .ty { color:var(--accent); }
  .terminal .ty.ok { color:var(--ok); }
  .terminal .ty.bad { color:var(--bad); }
  .terminal .by { color:var(--muted); }
  .terminal .empty { color:var(--faint); }
</style>
</head>
<body>
  <div id="gate" style="display:none">
    <h1>crew</h1>
    <p>Paste this machine's API token to view the dashboard (from <code>crew/crew.md</code> or <code>~/.crew/crew.md</code>, or Wrangler's "Copy API token" button).</p>
    <input id="tok" type="password" placeholder="token" autocomplete="off">
    <button id="go">Open dashboard</button>
    <div id="error"></div>
  </div>
  <div id="app" style="display:none">
    <h1>crew</h1>
    <div class="sub" id="sub"></div>
    <div id="empty" style="display:none">No registered projects. Run <code>crew init</code> or <code>crew migrate &lt;path&gt;</code>.</div>
    <div class="grid" id="grid"></div>
    <div id="detail" style="display:none"></div>
    <footer>Refreshes every 5s. Read-only -- use Wrangler in Obsidian to approve, answer, or pause.</footer>
  </div>
<script>
(function () {
  var qs = new URLSearchParams(location.search);
  var token = qs.get("token") || localStorage.getItem("crewToken") || "";
  var gate = document.getElementById("gate"), app = document.getElementById("app");
  var BAR_COLORS = ["#0ea5e9", "#d8a53f", "#a882d6", "#63b56a", "#e35b5b", "#5aa9c9"];

  var mode = null, lastProjects = [], lastStatuses = {}, selected = null;

  function showGate(msg) {
    gate.style.display = "block"; app.style.display = "none";
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

  function eventsPath(id) {
    return (mode === "machine" ? "/p/" + encodeURIComponent(id) + "/events" : "/events") + "?limit=40";
  }

  function agentRow(a) {
    var row = document.createElement("div"); row.className = "row";
    var left = document.createElement("span");
    var dot = document.createElement("span"); dot.className = "dot " + a.state;
    left.appendChild(dot);
    var name = document.createElement("span"); name.className = "name"; name.textContent = a.name;
    left.appendChild(name);
    row.appendChild(left);
    var right = document.createElement("span");
    right.textContent = a.state + "  $" + a.spend.toFixed(2);
    row.appendChild(right);
    return row;
  }

  function overviewCard(p, s) {
    var el = document.createElement("div"); el.className = "card clickable";
    el.onclick = function () { selected = p.id; renderCurrent(); };
    var h = document.createElement("h2");
    h.textContent = p.id;
    var pill = document.createElement("span"); pill.className = "pill " + (p.status === "active" ? "active" : "paused"); pill.textContent = p.status;
    h.appendChild(pill);
    el.appendChild(h);
    var path = document.createElement("div"); path.className = "path"; path.textContent = p.path + (p.missing ? "  (missing)" : ""); el.appendChild(path);
    if (s) {
      var running = s.agents.filter(function (a) { return a.state === "running"; }).length;
      var sleeping = s.agents.filter(function (a) { return a.state === "sleeping"; }).length;
      var needs = (s.review || 0) + (s.questions || 0) + ((s.tasks && s.tasks.blocked) || 0);
      var sum = document.createElement("div"); sum.className = "summary";
      sum.textContent = running + " running, " + sleeping + " sleeping, " + needs + " needs you, $" + s.spend.toFixed(2) + " today";
      el.appendChild(sum);
      s.agents.forEach(function (a) { el.appendChild(agentRow(a)); });
    }
    return el;
  }

  function renderOverview() {
    document.getElementById("detail").style.display = "none";
    var grid = document.getElementById("grid");
    grid.style.display = "grid";
    grid.innerHTML = "";
    document.getElementById("empty").style.display = lastProjects.length ? "none" : "block";
    document.getElementById("sub").textContent = mode === "machine"
      ? lastProjects.length + " registered project" + (lastProjects.length === 1 ? "" : "s")
      : "single project (v0)";
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

  function eventLine(e) {
    var line = document.createElement("div"); line.className = "line";
    var bad = /fail|error|reject|blocked|anomaly|expired/.test(e.type);
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
    var detail = document.getElementById("detail");
    detail.style.display = "block";
    detail.innerHTML = "";

    var back = document.createElement("div"); back.className = "back"; back.textContent = "\\u2190 All projects";
    back.onclick = function () { selected = null; renderCurrent(); };
    detail.appendChild(back);

    var h = document.createElement("h1"); h.textContent = p.id; detail.appendChild(h);
    var path = document.createElement("div"); path.className = "path"; path.textContent = p.path; detail.appendChild(path);

    if (!s) { var none = document.createElement("p"); none.className = "sub"; none.textContent = "No status yet."; detail.appendChild(none); return; }

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
      var noTasks = document.createElement("p"); noTasks.style.color = "var(--faint)"; noTasks.style.fontSize = "12.5px"; noTasks.textContent = "No tasks.";
      taskCard.appendChild(noTasks);
    } else {
      var maxTask = Math.max.apply(null, counts.concat([1]));
      order.forEach(function (k, i) { taskCard.appendChild(hbar(k, counts[i], maxTask, String(counts[i]), BAR_COLORS[i % BAR_COLORS.length])); });
    }
    grid.appendChild(taskCard);
    detail.appendChild(grid);

    var agentsCard = document.createElement("div"); agentsCard.className = "card"; agentsCard.style.marginBottom = "16px";
    var ah = document.createElement("h3"); ah.textContent = "Agents"; agentsCard.appendChild(ah);
    s.agents.forEach(function (a) {
      var row = document.createElement("div"); row.className = "row";
      var left = document.createElement("span");
      var dot = document.createElement("span"); dot.className = "dot " + a.state; left.appendChild(dot);
      var name = document.createElement("span"); name.className = "name"; name.textContent = a.name + "  "; left.appendChild(name);
      var meta = document.createElement("span"); meta.style.color = "var(--faint)"; meta.textContent = a.runner + "/" + (a.model || "-");
      left.appendChild(meta);
      row.appendChild(left);
      var right = document.createElement("span"); right.textContent = a.state + "  $" + a.spend.toFixed(2);
      row.appendChild(right);
      agentsCard.appendChild(row);
      if (a.lastLog) {
        var log = document.createElement("div"); log.style.fontSize = "11.5px"; log.style.color = "var(--faint)"; log.style.padding = "0 0 8px";
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
    api(eventsPath(p.id)).then(function (evs) {
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
        return Promise.all([api("/projects"), api("/status")]).then(function (r) {
          lastProjects = r[0]; lastStatuses = r[1];
        });
      }
      mode = "v0";
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

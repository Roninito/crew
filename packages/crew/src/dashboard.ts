// A read-only, dependency-free HTML page served at "/" by both serve() and serveMachine() -- a
// dashboard for glancing at crew from a plain browser, not just from inside Obsidian. No build
// step: it's static markup and vanilla JS, exactly like commands.ts's HELP text is a plain
// string. All dynamic content is set via textContent, never innerHTML, since project ids, paths
// and agent names ultimately come from user-controlled folder/file names.
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
  .card h2 { font-size:15px; font-weight:700; color:var(--fg-strong); margin-bottom:2px; }
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
    <footer>Refreshes every 5s. Read-only -- use Wrangler in Obsidian to approve, answer, or pause.</footer>
  </div>
<script>
(function () {
  var qs = new URLSearchParams(location.search);
  var token = qs.get("token") || localStorage.getItem("crewToken") || "";
  var gate = document.getElementById("gate"), app = document.getElementById("app");

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

  function card(title, path, statusPill, s) {
    var el = document.createElement("div"); el.className = "card";
    var h = document.createElement("h2");
    h.textContent = title;
    if (statusPill) {
      var pill = document.createElement("span"); pill.className = "pill " + statusPill.cls; pill.textContent = statusPill.text;
      h.appendChild(pill);
    }
    el.appendChild(h);
    if (path) { var p = document.createElement("div"); p.className = "path"; p.textContent = path; el.appendChild(p); }
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

  function render(projects, statuses, mode) {
    var grid = document.getElementById("grid");
    grid.innerHTML = "";
    document.getElementById("empty").style.display = projects.length ? "none" : "block";
    document.getElementById("sub").textContent = mode === "machine"
      ? projects.length + " registered project" + (projects.length === 1 ? "" : "s")
      : "single project (v0)";
    projects.forEach(function (p) {
      var s = statuses[p.id];
      var pill = { cls: p.status === "active" ? "active" : "paused", text: p.status };
      grid.appendChild(card(p.id, p.path + (p.missing ? "  (missing)" : ""), pill, s));
    });
  }

  function tick() {
    api("/health").then(function (health) {
      if (health.projects !== undefined) {
        return Promise.all([api("/projects"), api("/status")]).then(function (r) {
          render(r[0], r[1], "machine");
        });
      }
      return api("/status").then(function (s) {
        var id = (health.vault || "").split("/").pop() || "project";
        var projects = [{ id: id, path: health.vault, status: "active", missing: false }];
        var statuses = {}; statuses[id] = s;
        render(projects, statuses, "v0");
      });
    }).then(function () {
      gate.style.display = "none"; app.style.display = "block";
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

// crew serve: wakes subscribed agents on events, runs schedules, sweeps expired claims and lost jobs,
// flags anomalies, and exposes the HTTP API and live stream that Wrangler (and other tools) use.
//
// createProjectRuntime() holds all of this per project. serve(c) below is the v0 single-project
// host (--vault mode, unchanged behavior); the multi-project machine service (service.ts) calls
// the same factory once per registered project instead. Every function here already takes `c:
// Crew` explicitly -- there's no module-level "current vault" -- so running several at once in
// one process is a matter of not sharing closures, not rewriting the logic.
import { existsSync, openSync, readSync, closeSync, rmSync, statSync } from "node:fs";
import type { ServerWebSocket } from "bun";
import { type Agent, listAgents } from "./agents";
import { run } from "./commands";
import { type Crew, type CrewEvent, CrewError, emit, eventFiles, parseEvents, pidAlive, readEvents, readMd, withMutex, writeJson } from "./core";
import { cronMatches } from "./cron";
import { dashboardHtml } from "./dashboard";
import { listJobs, loadJob, releaseLocksFor, saveJob } from "./jobs";
import { listQuestions } from "./questions";
import { findProjectByPath } from "./registry";
import { type Wake, activeSessions, isPaused, launch, statusData } from "./runner";
import { listTasks, releaseTask } from "./tasks";

function subscribed(ag: Agent, type: string): boolean {
  return (ag.def.subscribes ?? []).some(
    (p) => p === "*" || p === type || (p.endsWith(".*") && type.startsWith(p.slice(0, -1))),
  );
}

function shouldWake(c: Crew, ag: Agent, ev: CrewEvent): boolean {
  if (!ag.def.enabled || !subscribed(ag, ev.type)) return false;
  // job.*/review.* and question.answered all target exactly one agent by name -- without this
  // bypass a question's answer would wake every agent subscribed to question.answered, not just
  // the one who asked it, the moment more than one agent in a project asks questions.
  if (ev.type.startsWith("job.") || ev.type.startsWith("review.") || ev.type === "question.answered") return ev.agent === ag.name;
  if (ev.by === ag.name) return false;
  if (ev.type === "task.ready" || ev.type === "task.created") {
    const needs =
      (ev.data?.needs as string[] | undefined) ?? listTasks(c).find((t) => t.id === ev.task)?.needs ?? [];
    const can = ag.def.can ?? [];
    return needs.every((n) => can.includes(n));
  }
  if (ev.type === "task.verify" && ev.agent === ag.name) return false; // never verify your own work
  return true;
}

export type ProjectRuntime = {
  c: Crew;
  clients: Set<ServerWebSocket<unknown>>;
  tick(): void;
  sweep(): Promise<void>;
  handleApi(pathname: string, req: Request, json: (v: unknown, status?: number) => Response): Promise<Response>;
};

export type ProjectRuntimeOpts = {
  // Tags every streamed event with { project: id } -- unset in v0's single-project serve(),
  // set by the machine service so a filtered /stream can tell projects' events apart.
  id?: string;
  // Lets a caller (the machine service) seed from a persisted position and hear about every
  // change, so a restart resumes instead of re-seeding at EOF ("don't replay history", v0's
  // behavior below, which is exactly right for a single long-lived --vault process but would
  // lose events written while the *machine* service itself was down).
  initial?: Map<string, number>;
  onChange?: (m: Map<string, number>) => void;
};

export function createProjectRuntime(c: Crew, opts?: ProjectRuntimeOpts): ProjectRuntime {
  const cfg = c.config();
  const clients = new Set<ServerWebSocket<unknown>>();
  const queue = new Map<string, Wake[]>();
  const launching = new Map<string, number>();
  const offsets = opts?.initial ?? new Map<string, number>();
  const failures = new Map<string, number>();
  const expiries = new Map<string, number>();
  let lastMinute = -1;

  if (!opts?.initial) for (const f of eventFiles(c)) offsets.set(f, statSync(f).size); // don't replay history

  const enqueue = (agent: string, w: Wake) => {
    const q = queue.get(agent) ?? [];
    if (q.length < 20) q.push(w);
    queue.set(agent, q);
  };

  const anomaly = (kind: string, ev: CrewEvent, detail: string) => {
    if (cfg.anomalies?.enabled === false) return;
    emit(c, { type: "crew.anomaly", by: "crew", task: ev.task, agent: ev.agent, data: { kind, detail } });
  };

  const onEvent = (ev: CrewEvent) => {
    const wire = opts?.id ? { ...ev, project: opts.id } : ev;
    for (const ws of clients) ws.send(JSON.stringify(wire));
    const threshold = cfg.anomalies?.repeat_threshold ?? 2;
    if (ev.type === "job.failed" || ev.type === "job.timeout") {
      const k = ev.task ?? String(ev.data?.job);
      const n = (failures.get(k) ?? 0) + 1;
      failures.set(k, n);
      if (n === threshold) anomaly("repeated_failures", ev, `${n} failed jobs on ${k}`);
    }
    if (ev.type === "task.released" && ev.data?.reason === "claim expired" && ev.task) {
      const n = (expiries.get(ev.task) ?? 0) + 1;
      expiries.set(ev.task, n);
      if (n === threshold) anomaly("claims_expiring", ev, `${ev.task} claim expired ${n} times`);
    }
    if (ev.type === "budget.exceeded") anomaly("budget", ev, String(ev.data?.reason ?? ""));
    // A session that starts and ends within one tick never shows up as "live" in between, so
    // dispatch()'s launching-cleanup (timeout or live) would otherwise leave it stuck "launching"
    // -- and un-wakeable -- for up to 15s even though it already finished. The event itself is the
    // precise signal, so clear it here instead of waiting on either heuristic.
    if (ev.type === "session.ended" && ev.agent) launching.delete(ev.agent);
    for (const ag of listAgents(c)) if (shouldWake(c, ag, ev)) enqueue(ag.name, { reason: `event ${ev.type}`, event: ev });
  };

  const readNewEvents = () => {
    let changed = false;
    for (const f of eventFiles(c)) {
      const size = statSync(f).size;
      const from = offsets.get(f) ?? 0;
      if (size <= from) continue;
      const fd = openSync(f, "r");
      const buf = Buffer.alloc(size - from);
      readSync(fd, buf, 0, buf.length, from);
      closeSync(fd);
      const text = buf.toString("utf8");
      const lastNl = text.lastIndexOf("\n");
      if (lastNl < 0) continue;
      offsets.set(f, from + Buffer.byteLength(text.slice(0, lastNl + 1)));
      changed = true;
      for (const ev of parseEvents(text.slice(0, lastNl + 1))) onEvent(ev);
    }
    if (changed) opts?.onChange?.(offsets);
  };

  const dispatch = () => {
    if (isPaused(c)) return;
    const max = cfg.limits?.max_sessions ?? 3;
    const live = activeSessions(c);
    const now = Date.now();
    for (const [k, t] of launching) if (now - t > 15_000 || live.some((s) => s.agent === k)) launching.delete(k);
    let count = live.length + launching.size;
    for (const [agent, q] of queue) {
      if (!q.length) continue;
      if (count >= max) break;
      if (live.some((s) => s.agent === agent) || launching.has(agent)) continue;
      const w = q.shift()!;
      if (q.length) w.reason += ` (+${q.length} more queued)`;
      launch(c, agent, w);
      launching.set(agent, now);
      count++;
    }
  };

  const schedule = () => {
    const d = new Date();
    const m = d.getHours() * 60 + d.getMinutes();
    if (m === lastMinute) return;
    lastMinute = m;
    for (const ag of listAgents(c))
      if (ag.def.enabled && ag.def.schedule && cronMatches(ag.def.schedule, d)) enqueue(ag.name, { reason: `schedule ${ag.def.schedule}` });
  };

  const sweep = async () => {
    await withMutex(c, () => {
      const jobs = listJobs(c);
      for (const j of jobs.filter((x) => x.status === "running" && !pidAlive(x.pid))) {
        const { j: cur, md } = loadJob(c, j.id);
        cur.status = "failed";
        cur.ended = new Date().toISOString();
        saveJob(c, cur, md);
        releaseLocksFor(c, j.id);
        emit(c, { type: "job.failed", by: "crew", agent: j.agent, task: j.task ?? undefined, data: { job: j.id, exit: null, reason: "job runner lost" } });
      }
      const activeJobTasks = new Set(jobs.filter((x) => ["queued", "waiting", "running"].includes(x.status)).map((x) => x.task));
      for (const t of listTasks(c))
        if (t.status === "claimed" && t.claim_expires && Date.parse(t.claim_expires) < Date.now() && !activeJobTasks.has(t.id))
          releaseTask(c, t.id, "crew", "claim expired");
      writeJson(c.p(".state", "sessions.json"), activeSessions(c));
    });
  };

  const handleApi = async (pathname: string, req: Request, json: (v: unknown, status?: number) => Response): Promise<Response> => {
    switch (pathname) {
      case "/status":
        return json(statusData(c));
      case "/tasks":
        return json(listTasks(c));
      case "/agents":
        return json(listAgents(c).map((a) => a.def));
      case "/jobs":
        return json(listJobs(c));
      case "/review":
        return json(
          listTasks(c)
            .filter((t) => t.status === "review" || (t.sampled && !t.sampled_ack))
            .map((t) => ({ ...t, notes: readMd(c.p("tasks", `${t.id}.md`)).body.split("## Notes")[1]?.trim() ?? "" })),
        );
      case "/questions":
        return json(
          listQuestions(c)
            .filter((q) => q.status === "open")
            .map((q) => ({ ...q, body: readMd(c.p("questions", `${q.id}.md`)).body })),
        );
      case "/events": {
        const url = new URL(req.url);
        const since = Number(url.searchParams.get("since") ?? Date.now() - 36e5);
        return json(readEvents(c, since).slice(-Number(url.searchParams.get("limit") ?? 200)));
      }
      case "/cmd": {
        if (req.method !== "POST") return json({ error: "POST only" }, 405);
        const body = (await req.json()) as { argv?: string[]; as?: string };
        const argv = body.argv ?? [];
        if (["serve", "session"].includes(argv[0] ?? "") || (argv[0] === "job" && argv[1] === "exec"))
          return json({ error: "not allowed over HTTP" }, 400);
        const o = await run(c, [...argv, ...(body.as ? ["--as", body.as] : [])]);
        return json({ code: o.code, out: o.lines.join("\n"), data: o.json ?? null });
      }
      default:
        return json({ error: "not found" }, 404);
    }
  };

  return {
    c,
    clients,
    tick() {
      readNewEvents();
      schedule();
      dispatch();
    },
    sweep,
    handleApi,
  };
}

export async function serve(c: Crew): Promise<void> {
  const registered = findProjectByPath(c.vault);
  if (registered?.status === "active")
    throw new CrewError(
      `${c.vault} is registered with the machine service as "${registered.id}". Run the machine service instead (crew serve, no --vault), or "crew project pause ${registered.id}" first if you really want a standalone server here -- both use port 7717 by default and can't run at once.`,
    );
  const cfg = c.config();
  const port = cfg.api?.port ?? 7717;
  const token = cfg.api?.token ?? "";
  const rt = createProjectRuntime(c);

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req, srv) {
      const url = new URL(req.url);
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
      if (req.method === "OPTIONS") return new Response(null, { headers: cors });
      const json = (v: unknown, status = 200) => Response.json(v, { status, headers: cors });
      if (url.pathname === "/health") return json({ ok: true, vault: c.vault, pid: process.pid });
      if (url.pathname === "/" && req.method === "GET") return new Response(dashboardHtml, { headers: { ...cors, "content-type": "text/html; charset=utf-8" } });
      const auth = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? url.searchParams.get("token");
      if (token && auth !== token) return json({ error: "unauthorized" }, 401);
      if (url.pathname === "/stream") return srv.upgrade(req) ? undefined : json({ error: "upgrade failed" }, 400);
      try {
        return await rt.handleApi(url.pathname, req, json);
      } catch (e) {
        return json({ error: (e as Error).message }, 500);
      }
    },
    websocket: {
      open(ws) {
        rt.clients.add(ws);
      },
      close(ws) {
        rt.clients.delete(ws);
      },
      message() {
        /* read-only stream */
      },
    },
  });

  const stateFile = c.p(".state", "server.json");
  writeJson(stateFile, { pid: process.pid, port: server.port, started: new Date().toISOString() });
  emit(c, { type: "crew.server_started", by: "crew", data: { port: server.port } });
  console.log(`crew server on http://127.0.0.1:${server.port} for ${c.vault}`);

  const shutdown = () => {
    if (existsSync(stateFile)) rmSync(stateFile, { force: true });
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  let ticks = 0;
  setInterval(() => {
    try {
      rt.tick();
      if (++ticks % 30 === 0) void rt.sweep().catch((e) => console.error("sweep:", e));
    } catch (e) {
      console.error("tick:", e);
    }
  }, 1000);
}

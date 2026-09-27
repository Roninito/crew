// crew serve with no --vault: the machine service. Loads every registered active project into a
// Map<projectId, ProjectRuntime> behind one Bun.serve, ticking each project's dispatcher in its
// own try/catch so a throw in one project never stops another (see server.ts's
// createProjectRuntime, reused here unchanged per project). Registered projects are added or
// dropped by polling projects.md's mtime once per tick -- no new IPC, same file-polling approach
// crew already uses for events and schedules.
import { existsSync, rmSync } from "node:fs";
import type { ServerWebSocket } from "bun";
import { Crew, emit, join, readJson, writeJson } from "./core";
import { ensureMachineHome, machineConfig, machineHome } from "./machine";
import { listProjects, registryMtimeMs } from "./registry";
import { statusData } from "./runner";
import { createProjectRuntime, type ProjectRuntime } from "./server";

type WsData = { projects: Set<string> | null };

export async function serveMachine(): Promise<void> {
  const home = machineHome();
  ensureMachineHome(home);
  const mcfg = machineConfig(home);
  const port = mcfg.api?.port ?? 7717;
  const token = mcfg.api?.token ?? "";

  const offsetsPath = join(home, ".state", "offsets.json");
  const persisted = readJson<Record<string, Record<string, number>>>(offsetsPath, {});
  const savePersisted = () => writeJson(offsetsPath, persisted);

  const runtimes = new Map<string, ProjectRuntime>();

  const load = (id: string, path: string) => {
    const c = new Crew(path);
    const rt = createProjectRuntime(c, {
      id,
      initial: new Map(Object.entries(persisted[id] ?? {})),
      onChange: (m) => {
        persisted[id] = Object.fromEntries(m);
        savePersisted();
      },
    });
    runtimes.set(id, rt);
  };

  const reloadRegistry = () => {
    const active = new Set(listProjects(home).filter((p) => p.status === "active").map((p) => p.id));
    for (const id of [...runtimes.keys()]) if (!active.has(id)) runtimes.delete(id);
    for (const p of listProjects(home)) if (p.status === "active" && !runtimes.has(p.id)) load(p.id, p.path);
  };
  reloadRegistry();
  let lastRegMtime = registryMtimeMs(home);

  const server = Bun.serve<WsData>({
    port,
    hostname: "127.0.0.1",
    async fetch(req, srv) {
      const url = new URL(req.url);
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
      if (req.method === "OPTIONS") return new Response(null, { headers: cors });
      const json = (v: unknown, status = 200) => Response.json(v, { status, headers: cors });
      if (url.pathname === "/health") return json({ ok: true, home, pid: process.pid, projects: runtimes.size });
      const auth = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? url.searchParams.get("token");
      if (token && auth !== token) return json({ error: "unauthorized" }, 401);

      if (url.pathname === "/stream") {
        const wanted = url.searchParams.getAll("project");
        return srv.upgrade(req, { data: { projects: wanted.length ? new Set(wanted) : null } })
          ? undefined
          : json({ error: "upgrade failed" }, 400);
      }
      if (url.pathname === "/projects") return json(listProjects(home).map((p) => ({ ...p, missing: !existsSync(p.path) })));
      if (url.pathname === "/status") {
        const out: Record<string, unknown> = {};
        for (const [id, rt] of runtimes) out[id] = statusData(rt.c);
        return json(out);
      }
      const p = url.pathname.match(/^\/p\/([^/]+)(\/.*)$/);
      if (p) {
        const rt = runtimes.get(p[1]!);
        if (!rt) return json({ error: `unknown or inactive project "${p[1]}"` }, 404);
        try {
          return await rt.handleApi(p[2]!, req, json);
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      }
      if (url.pathname === "/cmd") {
        if (req.method !== "POST") return json({ error: "POST only" }, 405);
        const body = (await req.json()) as { argv?: string[]; as?: string; project?: string };
        const rt = body.project ? runtimes.get(body.project) : undefined;
        if (!rt) return json({ error: `Pass a known "project" id. Registered: ${[...runtimes.keys()].join(", ") || "(none)"}` }, 400);
        const forwarded = new Request(req.url, { method: "POST", body: JSON.stringify({ argv: body.argv, as: body.as }) });
        try {
          return await rt.handleApi("/cmd", forwarded, json);
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      }
      return json({ error: "not found" }, 404);
    },
    websocket: {
      open(ws) {
        for (const [id, rt] of runtimes) if (!ws.data.projects || ws.data.projects.has(id)) rt.clients.add(ws);
      },
      close(ws) {
        for (const rt of runtimes.values()) rt.clients.delete(ws);
      },
      message() {
        /* read-only stream */
      },
    },
  });

  const stateFile = join(home, ".state", "pid.json");
  writeJson(stateFile, { pid: process.pid, port: server.port, started: new Date().toISOString() });
  console.log(`crew machine service on http://127.0.0.1:${server.port}, home ${home}, ${runtimes.size} project(s)`);

  const shutdown = () => {
    if (existsSync(stateFile)) rmSync(stateFile, { force: true });
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  let ticks = 0;
  setInterval(() => {
    const m = registryMtimeMs(home);
    if (m !== lastRegMtime) {
      lastRegMtime = m;
      try {
        reloadRegistry();
      } catch (e) {
        console.error("registry reload:", e); // stale registry read (e.g. mid-write elsewhere); retried next tick
      }
    }
    for (const [id, rt] of runtimes) {
      try {
        rt.tick();
      } catch (e) {
        console.error(`[${id}] tick:`, e);
        try {
          emit(rt.c, { type: "crew.anomaly", by: "crew", data: { kind: "dispatcher_error", detail: String(e) } });
        } catch {
          /* even emitting failed (e.g. the project's own folder vanished mid-tick); already logged above */
        }
      }
    }
    if (++ticks % 30 === 0) for (const [id, rt] of runtimes) void rt.sweep().catch((e) => console.error(`[${id}] sweep:`, e));
  }, 1000);
}

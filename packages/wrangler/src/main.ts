// Wrangler: the Obsidian face of crew. It starts or attaches to `crew serve` for this vault
// and shows the team as views. Every action goes through the crew HTTP API, so crew stays the single writer.
import { type ChildProcess, spawn } from "child_process";
import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  type App,
  FileSystemAdapter,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  type WorkspaceLeaf,
  requestUrl,
  setTooltip,
} from "obsidian";
import { type IconName, ICONS } from "./icons";
import { VAULT_ASSETS } from "./vault-assets.generated";
import { detectRunners, isNewerVersion, parseRunnersFromFrontmatter, platformAssetName, runCapture } from "./lib";

const CREW_REPO = "roninito/crew";
const CREW_RELEASES = `https://github.com/${CREW_REPO}/releases/latest/download`;
const VAULT_DIRS = [
  "agents", "tasks", "blackboard", "events", "jobs", "assets",
  "reviews", "traces", "worktrees", "wiki", "templates/agents",
  "templates/scripts", "skills", ".state",
];

/**
 * Obsidian (and anything it spawns, including the crew server) starts with launchd's minimal PATH,
 * not the user's normal login PATH -- so a runner CLI installed via Homebrew, nvm, or a per-user
 * bin dir looks "missing" even when it's on the user's own PATH. Resolve the real one once via the
 * user's shell so the crew server -- and everything it in turn spawns -- can find those CLIs.
 */
async function resolveLoginPath(): Promise<string | null> {
  if (process.platform === "win32") return null;
  const res = await runCapture(`printf '%s' "$PATH"`);
  // An interactive shell can print its own noise before our command runs (iTerm2's shell
  // integration prints a "Restored session: ..." line, for one) -- printf is the last thing in
  // the -c script and never emits its own trailing newline, so its output is always the last line.
  const p = res.stdout.trim().split("\n").at(-1)?.trim() ?? "";
  return res.code === 0 && p ? p : null;
}

// ---------- types from the crew API ----------
type AgentStatus = {
  name: string;
  state: "running" | "sleeping" | "idle" | "blocked" | "disabled";
  runner: string;
  model: string;
  task: string | null;
  lastLog: string;
  spend: number;
};
type Status = {
  server: { running: boolean; pid?: number; port?: number; started?: string };
  paused: boolean;
  agents: AgentStatus[];
  tasks: Record<string, number>;
  review: number;
  jobs: number;
  spend: number;
};
type Task = {
  id: string;
  title: string;
  type: string;
  status: string;
  needs: string[];
  claimed_by: string | null;
  worker: string | null;
  acceptance: string[];
  recommendation: string | null;
  sampled: boolean;
  sampled_ack: boolean;
  notes?: string;
};
type Job = { id: string; agent: string; task: string | null; status: string; lock: string | null; script: string; created: string };
type CrewEvent = { ts: string; type: string; by: string; task?: string; data?: Record<string, unknown> };
type CmdResult = { code: number; out: string; data: unknown };

interface Settings {
  bunPath: string;
  crewCliPath: string;
  autoStart: boolean;
  refreshSeconds: number;
}
const DEFAULTS: Settings = { bunPath: "bun", crewCliPath: "", autoStart: true, refreshSeconds: 5 };

const VIEW_CREW = "crew-sidebar";
const VIEW_BOARD = "crew-board";
const VIEW_REVIEW = "crew-review";
const VIEW_FEED = "crew-feed";
const VIEW_JOBS = "crew-jobs";
const COLUMNS = ["inbox", "ready", "claimed", "verify", "review", "done", "blocked"];
const STATE_MARK: Record<string, string> = { running: "●", sleeping: "◐", idle: "○", blocked: "■", disabled: "–" };

// ---------- plugin ----------
export default class WranglerPlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  port = 7717;
  token = "";
  child: ChildProcess | null = null;
  status: Status | null = null;
  online = false;
  private ws: WebSocket | null = null;
  private statusEl: HTMLElement | null = null;
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) as Partial<Settings>) };
    this.addSettingTab(new WranglerSettingTab(this.app, this));
    this.registerView(VIEW_CREW, (l) => new CrewSidebarView(l, this));
    this.registerView(VIEW_BOARD, (l) => new BoardView(l, this));
    this.registerView(VIEW_REVIEW, (l) => new ReviewView(l, this));
    this.registerView(VIEW_FEED, (l) => new FeedView(l, this));
    this.registerView(VIEW_JOBS, (l) => new JobsView(l, this));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("crew-statusbar");
    this.statusEl.onClickEvent(() => void this.openView(VIEW_REVIEW, "tab"));

    this.addRibbonIcon("users", "Open crew", () => void this.openView(VIEW_CREW, "right"));
    this.addCommand({ id: "open-crew", name: "Open crew sidebar", callback: () => void this.openView(VIEW_CREW, "right") });
    this.addCommand({ id: "open-board", name: "Open board", callback: () => void this.openView(VIEW_BOARD, "tab") });
    this.addCommand({ id: "open-review", name: "Open review inbox", callback: () => void this.openView(VIEW_REVIEW, "tab") });
    this.addCommand({ id: "open-feed", name: "Open blackboard feed", callback: () => void this.openView(VIEW_FEED, "tab") });
    this.addCommand({ id: "open-jobs", name: "Open jobs", callback: () => void this.openView(VIEW_JOBS, "tab") });
    this.addCommand({ id: "new-task", name: "Create task", callback: () => new NewTaskModal(this.app, this).open() });
    this.addCommand({ id: "spawn-agent", name: "Spawn agent from template", callback: () => new NewAgentModal(this.app, this).open() });
    this.addCommand({ id: "broadcast", name: "Broadcast event", callback: () => new BroadcastModal(this.app, this).open() });
    this.addCommand({
      id: "trace-task",
      name: "Trace current task",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        const id = f?.path.match(/crew\/tasks\/(T-\d+)\.md$/)?.[1];
        if (!id) return false;
        if (!checking) void this.trace(id);
        return true;
      },
    });
    this.addCommand({
      id: "kill-switch",
      name: "Kill switch: stop every session and job",
      callback: () =>
        new ConfirmModal(this.app, "Stop every agent session and job, release every lock, and return agent claims to ready?", async () => {
          await this.run(["stop", "--all"], true);
        }).open(),
    });

    this.app.workspace.onLayoutReady(() => void this.connect());
  }

  onunload(): void {
    this.ws?.close();
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
    if (this.child) this.child.kill("SIGTERM");
  }

  vaultPath(): string {
    const a = this.app.vault.adapter;
    return a instanceof FileSystemAdapter ? a.getBasePath() : "";
  }

  async readConfig(): Promise<boolean> {
    try {
      const raw = await this.app.vault.adapter.read("crew/crew.md");
      this.port = Number(raw.match(/^\s*port:\s*(\d+)/m)?.[1] ?? 7717);
      this.token = raw.match(/^\s*token:\s*"?([A-Za-z0-9]+)"?/m)?.[1] ?? "";
      return true;
    } catch {
      return false;
    }
  }

  async health(): Promise<boolean> {
    try {
      const r = await requestUrl({ url: `http://127.0.0.1:${this.port}/health`, throw: false });
      const body = r.json as { ok?: boolean; vault?: string };
      return r.status === 200 && !!body.ok;
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    await this.ensureVaultSetup();
    if (!(await this.readConfig())) {
      this.setStatusText("crew: not set up in this vault");
      return;
    }
    if (!(await this.health()) && this.settings.autoStart) await this.startServer();
    this.online = await this.health();
    this.openStream();
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
    this.refreshTimer = window.setInterval(() => void this.refresh(), Math.max(2, this.settings.refreshSeconds) * 1000);
    this.registerInterval(this.refreshTimer);
    await this.refresh();
  }

  /** Creates the crew/ folder layout, templates, token and skill on first enable in a vault. Safe to re-run. */
  async ensureVaultSetup(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (await adapter.exists("crew/crew.md")) return;

    const vaultPath = this.vaultPath();
    const vaultName = basename(vaultPath);
    const assetsDir = join(dirname(vaultPath), `${vaultName}-assets`);

    for (const d of VAULT_DIRS) await adapter.mkdir(`crew/${d}`);
    for (const [rel, content] of Object.entries(VAULT_ASSETS)) {
      const target = `crew/${rel}`;
      if (await adapter.exists(target)) continue;
      const dir = rel.includes("/") ? `crew/${rel.slice(0, rel.lastIndexOf("/"))}` : "";
      if (dir) await adapter.mkdir(dir);
      const filled =
        rel === "crew.md"
          ? content
              .replace("{{TOKEN}}", randomBytes(16).toString("hex"))
              .replace("{{VAULT_NAME}}", vaultName)
              .replace("{{ASSETS}}", assetsDir)
          : content;
      await adapter.write(target, filled);
    }
    // Also give a Copilot-style skills folder the crew-manager skill, if this vault already has one,
    // so that copilot can run the team without waiting on crew/skills/crew-manager to be pointed at.
    if (await adapter.exists(".copilot/skills")) {
      for (const [rel, content] of Object.entries(VAULT_ASSETS)) {
        if (!rel.startsWith("skills/crew-manager/")) continue;
        const target = rel.replace(/^skills\//, ".copilot/skills/");
        if (await adapter.exists(target)) continue;
        await adapter.mkdir(target.slice(0, target.lastIndexOf("/")));
        await adapter.write(target, content);
      }
    }
    try {
      mkdirSync(assetsDir, { recursive: true });
    } catch {
      /* best effort; crew will still run without it until a job needs it */
    }
    new Notice(`Wrangler set up crew/ in this vault. External assets folder: ${assetsDir}`);
  }

  /** Where install-wrangler.sh (or an earlier vault's Wrangler) installs crew globally, on PATH. */
  globalCrewPath(): string {
    return join(homedir(), ".local", "bin", process.platform === "win32" ? "crew.exe" : "crew");
  }

  /** Where Wrangler keeps its own downloaded copy of crew, if no global install exists yet. */
  managedCrewPath(): string {
    const dir = join(this.vaultPath(), this.app.vault.configDir, "plugins", "wrangler", "bin");
    return join(dir, process.platform === "win32" ? "crew.exe" : "crew");
  }

  /** Prefers the global install (so a terminal's `crew` and Wrangler's server are the same binary). */
  async resolveCrewBinary(): Promise<string | null> {
    const global = this.globalCrewPath();
    if (existsSync(global)) return global;
    const managed = await this.ensureCrewBinary();
    if (managed) this.linkGlobalCrew(managed);
    return managed;
  }

  /** Best-effort: only fills an empty slot, never overwrites -- something else (or the user) may already be there. */
  linkGlobalCrew(target: string): void {
    if (process.platform === "win32") return;
    const link = this.globalCrewPath();
    if (existsSync(link)) return;
    try {
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(target, link);
    } catch {
      /* best effort; Wrangler's own use of the managed copy is unaffected either way */
    }
  }

  releaseAssetName(): string | null {
    return platformAssetName(process.platform, process.arch);
  }

  /** Downloads the platform's crew binary from GitHub Releases the first time it's needed. */
  async ensureCrewBinary(): Promise<string | null> {
    const dest = this.managedCrewPath();
    if (existsSync(dest)) return dest;
    const asset = this.releaseAssetName();
    if (!asset) {
      new Notice(`Wrangler: no prebuilt crew for ${process.platform}/${process.arch}. Set the crew CLI path in settings instead.`);
      return null;
    }
    new Notice("Wrangler: downloading crew for this vault (first run only)...");
    try {
      const res = await requestUrl({ url: `${CREW_RELEASES}/${asset}`, throw: false });
      if (res.status !== 200) {
        new Notice(`Wrangler couldn't download crew (HTTP ${res.status}). Set the crew CLI path in settings instead.`);
        return null;
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, Buffer.from(res.arrayBuffer));
      chmodSync(dest, 0o755);
      return dest;
    } catch (e) {
      new Notice(`Wrangler couldn't download crew: ${(e as Error).message}`);
      return null;
    }
  }

  async startServer(): Promise<void> {
    let cmd: string;
    let args: string[];
    if (this.settings.crewCliPath) {
      cmd = this.settings.bunPath;
      args = [this.settings.crewCliPath, "serve", "--vault", this.vaultPath()];
    } else {
      const bin = await this.resolveCrewBinary();
      if (!bin) return;
      cmd = bin;
      args = ["serve", "--vault", this.vaultPath()];
    }
    const loginPath = await resolveLoginPath();
    const env = { ...process.env };
    if (loginPath) env.PATH = loginPath;
    try {
      this.child = spawn(cmd, args, {
        stdio: "ignore",
        env,
      });
      this.child.on("exit", () => {
        this.child = null;
        void this.refresh();
      });
      this.child.on("error", (e) => new Notice(`Wrangler couldn't start crew: ${e.message}`));
    } catch (e) {
      new Notice(`Wrangler couldn't start crew: ${(e as Error).message}`);
      return;
    }
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      if (await this.health()) return;
    }
    new Notice("Wrangler: crew server didn't respond. Check the crew CLI path in settings if you're running from source.");
  }

  stopServer(): void {
    if (this.child) {
      this.child.kill("SIGTERM");
      this.child = null;
    } else if (this.status?.server.pid) {
      try {
        process.kill(this.status.server.pid, "SIGTERM");
      } catch {
        new Notice("crew is running as a service. Stop it with scripts/service.sh uninstall.");
      }
    }
    this.online = false;
    void this.refresh();
  }

  openStream(): void {
    this.ws?.close();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}/stream?token=${this.token}`);
      let pending: number | null = null;
      ws.onmessage = () => {
        if (pending) return;
        pending = window.setTimeout(() => {
          pending = null;
          void this.refresh();
        }, 400);
      };
      ws.onclose = () => {
        this.ws = null;
        window.setTimeout(() => {
          if (!this.ws) this.openStream();
        }, 5000);
      };
      this.ws = ws;
    } catch {
      /* server not up yet; the interval will retry through refresh */
    }
  }

  async get<T>(path: string): Promise<T> {
    const r = await requestUrl({
      url: `http://127.0.0.1:${this.port}${path}`,
      headers: { Authorization: `Bearer ${this.token}` },
    });
    return r.json as T;
  }

  async run(argv: string[], notify = false): Promise<CmdResult> {
    try {
      const r = await requestUrl({
        url: `http://127.0.0.1:${this.port}/cmd`,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ argv, as: "human" }),
      });
      const res = r.json as CmdResult;
      if (notify || res.code !== 0) new Notice(res.out || (res.code ? "crew command failed" : "Done"));
      void this.refresh();
      return res;
    } catch (e) {
      new Notice("crew server isn't reachable. Open the crew sidebar to start it.");
      return { code: 1, out: (e as Error).message, data: null };
    }
  }

  async refresh(): Promise<void> {
    try {
      this.status = await this.get<Status>("/status");
      this.online = true;
      if (!this.ws) this.openStream();
    } catch {
      this.online = false;
      this.status = null;
    }
    this.renderStatusBar();
    for (const type of [VIEW_CREW, VIEW_BOARD, VIEW_REVIEW, VIEW_FEED, VIEW_JOBS])
      for (const leaf of this.app.workspace.getLeavesOfType(type)) void (leaf.view as CrewView).render();
  }

  setStatusText(t: string, live = false): void {
    if (!this.statusEl) return;
    this.statusEl.empty();
    this.statusEl.createSpan({ cls: `crew-dot-mini${live ? " is-running" : ""}`, text: "●" });
    this.statusEl.appendText(t);
  }

  renderStatusBar(): void {
    const s = this.status;
    if (!this.online || !s) return this.setStatusText("crew: offline");
    const running = s.agents.filter((a) => a.state === "running").length;
    const sleeping = s.agents.filter((a) => a.state === "sleeping").length;
    const paused = s.paused ? "paused, " : "";
    this.setStatusText(`crew: ${paused}${running} running, ${sleeping} sleeping, ${s.review} to review, $${s.spend.toFixed(2)} today`, running > 0);
  }

  async openView(type: string, where: "right" | "tab"): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(type)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = where === "right" ? this.app.workspace.getRightLeaf(false) : this.app.workspace.getLeaf("tab");
    if (!leaf) return;
    await leaf.setViewState({ type, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  openNote(path: string): void {
    void this.app.workspace.openLinkText(path, "", false);
  }

  async trace(id: string): Promise<void> {
    const r = await this.run(["trace", id]);
    if (r.code === 0) this.openNote(`crew/traces/${id}.md`);
  }

  /** Runner ids already configured under runners: in crew/crew.md, so the spawn form can flag ones that aren't. */
  async configuredRunners(): Promise<Set<string>> {
    try {
      const raw = await this.app.vault.adapter.read("crew/crew.md");
      return parseRunnersFromFrontmatter(raw);
    } catch {
      return new Set();
    }
  }

  pluginDir(): string {
    return join(this.vaultPath(), this.app.vault.configDir, "plugins", "wrangler");
  }

  /** Compares against the crew repo's latest release tag; updates main.js/manifest.json/styles.css in place if newer. */
  async checkForUpdates(notifyIfCurrent = true): Promise<void> {
    let latest: string | null = null;
    try {
      const res = await requestUrl({ url: `https://api.github.com/repos/${CREW_REPO}/releases/latest`, throw: false });
      if (res.status === 200) latest = ((res.json as { tag_name?: string }).tag_name ?? "").replace(/^v/, "") || null;
    } catch {
      /* network hiccup; report below */
    }
    if (!latest) {
      new Notice("Wrangler: couldn't check for updates.");
      return;
    }
    const current = this.manifest.version;
    if (!isNewerVersion(latest, current)) {
      if (notifyIfCurrent) new Notice(`Wrangler is up to date (v${current}).`);
      return;
    }
    new Notice(`Wrangler: updating to v${latest}...`);
    try {
      const dir = this.pluginDir();
      for (const f of ["main.js", "manifest.json", "styles.css"]) {
        const res = await requestUrl({ url: `${CREW_RELEASES}/${f}`, throw: false });
        if (res.status !== 200) throw new Error(`couldn't download ${f} (HTTP ${res.status})`);
        writeFileSync(join(dir, f), res.text);
      }
      new Notice(`Wrangler updated to v${latest}. Reload Obsidian (Cmd/Ctrl+R) to finish.`);
    } catch (e) {
      new Notice(`Wrangler update failed: ${(e as Error).message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

// ---------- views ----------
abstract class CrewView extends ItemView {
  constructor(leaf: WorkspaceLeaf, protected plugin: WranglerPlugin) {
    super(leaf);
  }
  getIcon(): string {
    return "users";
  }
  async onOpen(): Promise<void> {
    this.contentEl.addClass("crew-view");
    await this.render();
  }
  abstract render(): Promise<void>;
  offline(el: HTMLElement): boolean {
    if (this.plugin.online) return false;
    const box = el.createDiv({ cls: "crew-empty" });
    box.createEl("p", { text: "The crew server isn't running for this vault." });
    const b = box.createEl("button", { text: "Start crew", cls: "mod-cta" });
    b.onclick = async () => {
      await this.plugin.startServer();
      await this.plugin.connect();
    };
    return true;
  }
}

class CrewSidebarView extends CrewView {
  getViewType(): string {
    return VIEW_CREW;
  }
  getDisplayText(): string {
    return "Crew";
  }
  async render(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    const s = this.plugin.status;
    const server = el.createDiv({ cls: "crew-server" });
    const heading = server.createEl("h4");
    heading.createSpan({ cls: "crew-kicker", text: "Wrangler:" });
    heading.appendText(" Crew Server");
    if (!this.plugin.online || !s) {
      this.offline(el);
      return;
    }
    const mode = this.plugin.child ? "started by Wrangler" : "running separately (service or terminal)";
    server.createEl("p", { text: `Running on port ${s.server.port}, ${mode}.${s.paused ? " Paused by the kill switch." : ""}` });
    const row = server.createDiv({ cls: "crew-actions" });
    if (s.paused) iconBtn(row, "play", "Resume agents (lift the kill switch)", () => this.plugin.run(["resume"], true), true);
    iconBtn(row, "off-tag", "Stop the crew server", async () => this.plugin.stopServer());
    iconBtn(row, "copy", "Copy API token", async () => {
      await navigator.clipboard.writeText(this.plugin.token);
      new Notice("Token copied.");
    });

    const head = el.createDiv({ cls: "crew-agents-head" });
    head.createEl("h4", { text: "Agents" });
    iconBtn(head, "user-plus", "Spawn a new agent", async () => new NewAgentModal(this.app, this.plugin).open());
    if (!s.agents.length) el.createEl("p", { cls: "crew-muted", text: "No agents yet. Spawn one from a template." });
    for (const a of s.agents) {
      const card = el.createDiv({ cls: `crew-agent is-${a.state}` });
      const top = card.createDiv({ cls: "crew-agent-top" });
      top.createSpan({ cls: "crew-agent-name", text: a.name });
      const state = top.createSpan({ cls: `crew-state is-${a.state}` });
      state.createSpan({ cls: "crew-dot", text: STATE_MARK[a.state] ?? "" });
      state.appendText(` ${a.state}`);
      const meta = card.createDiv({ cls: "crew-muted" });
      meta.setText(`${a.runner}/${a.model || "-"}, $${a.spend.toFixed(2)} today`);
      if (a.task) {
        const t = card.createDiv();
        t.createSpan({ text: "Working on " });
        const link = t.createEl("a", { text: a.task });
        link.onclick = () => this.plugin.openNote(`crew/tasks/${a.task}.md`);
      }
      if (a.lastLog) card.createDiv({ cls: "crew-log", text: a.lastLog });
      const acts = card.createDiv({ cls: "crew-actions" });
      if (a.state !== "disabled") {
        iconBtn(acts, "flash", "Wake this agent now", () => this.plugin.run(["wake", a.name], true));
        iconBtn(acts, "pause", "Disable this agent", () => this.plugin.run(["agent", "disable", a.name], true));
      } else iconBtn(acts, "play", "Enable this agent", () => this.plugin.run(["agent", "enable", a.name], true));
      iconBtn(acts, "edit-pencil", "Edit runner/model", async () => new EditAgentModal(this.app, this.plugin, a.name, a.runner, a.model).open());
      iconBtn(acts, "arrow-up-right-circle", "Open agent.md", async () => this.plugin.openNote(`crew/agents/${a.name}/agent.md`));
    }
  }
}

class BoardView extends CrewView {
  getViewType(): string {
    return VIEW_BOARD;
  }
  getDisplayText(): string {
    return "Crew board";
  }
  getIcon(): string {
    return "kanban-square";
  }
  async render(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    if (this.offline(el)) return;
    const bar = el.createDiv({ cls: "crew-actions" });
    btn(bar, "New task", async () => new NewTaskModal(this.app, this.plugin).open(), true);
    let tasks: Task[] = [];
    try {
      tasks = await this.plugin.get<Task[]>("/tasks");
    } catch {
      return;
    }
    const board = el.createDiv({ cls: "crew-board" });
    for (const col of COLUMNS) {
      const items = tasks.filter((t) => t.status === col);
      const c = board.createDiv({ cls: "crew-col" });
      c.createEl("h5", { text: `${capitalize(col)} (${items.length})` });
      c.ondragover = (e) => e.preventDefault();
      c.ondrop = async (e) => {
        e.preventDefault();
        const id = e.dataTransfer?.getData("text/plain");
        if (!id) return;
        if (col === "claimed") await this.plugin.run(["claim", id]);
        else await this.plugin.run(["task", "update", id, "--status", col]);
      };
      for (const t of items) {
        const card = c.createDiv({ cls: "crew-card" });
        card.draggable = true;
        card.ondragstart = (e) => e.dataTransfer?.setData("text/plain", t.id);
        const title = card.createDiv({ cls: "crew-card-title" });
        const link = title.createEl("a", { text: t.id });
        link.onclick = () => this.plugin.openNote(`crew/tasks/${t.id}.md`);
        title.createSpan({ text: ` ${t.title}` });
        const meta = card.createDiv({ cls: "crew-muted" });
        meta.setText(`${t.claimed_by ?? t.worker ?? "unassigned"}, needs ${t.needs.join(", ") || "nothing"}`);
        if (t.status === "ready") btn(card, "Take it", () => this.plugin.run(["claim", t.id], true));
      }
    }
  }
}

class ReviewView extends CrewView {
  getViewType(): string {
    return VIEW_REVIEW;
  }
  getDisplayText(): string {
    return "Crew review";
  }
  getIcon(): string {
    return "check-square";
  }
  async render(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    if (this.offline(el)) return;
    let items: Task[] = [];
    try {
      items = await this.plugin.get<Task[]>("/review");
    } catch {
      return;
    }
    el.createEl("h4", { text: "Review" });
    if (!items.length) {
      el.createEl("p", { cls: "crew-muted", text: "Nothing needs you. Escalated work and sampled approvals show up here." });
      return;
    }
    for (const t of items) {
      const box = el.createDiv({ cls: "crew-review" });
      const h = box.createDiv({ cls: "crew-card-title" });
      const link = h.createEl("a", { text: t.id });
      link.onclick = () => this.plugin.openNote(`crew/tasks/${t.id}.md`);
      h.createSpan({ text: ` ${t.title}` });
      const kind = t.status === "review" ? `Escalated${t.recommendation ? `, verifier recommends ${t.recommendation}` : ""}` : "Sampled auto-approval: do you agree?";
      box.createDiv({ cls: "crew-muted", text: `${kind}. Worker: ${t.worker ?? "unknown"}.` });
      const ul = box.createEl("ul");
      for (const a of t.acceptance) ul.createEl("li", { text: a });
      const last = (t.notes ?? "").split("\n").filter(Boolean).slice(-3);
      if (last.length) box.createEl("pre", { cls: "crew-notes", text: last.join("\n") });
      const acts = box.createDiv({ cls: "crew-actions" });
      if (t.status === "review") {
        btn(acts, "Approve", () => this.plugin.run(["verdict", t.id, "approve"], true), true);
        btn(acts, "Reject", async () =>
          new PromptModal(this.app, "What needs fixing?", async (reason) => {
            await this.plugin.run(["verdict", t.id, "reject", "--reason", reason], true);
          }).open(),
        );
      } else {
        btn(acts, "Agree", () => this.plugin.run(["verdict", t.id, "agree"], true), true);
        btn(acts, "Disagree", async () =>
          new PromptModal(this.app, "What did the verifier miss?", async (reason) => {
            await this.plugin.run(["verdict", t.id, "disagree", "--reason", reason], true);
          }).open(),
        );
      }
      btn(acts, "Audit", async () => {
        const r = await this.plugin.run(["audit", t.id]);
        new OutputModal(this.app, `Audit of ${t.id}`, r.out).open();
      });
      btn(acts, "Trace", () => this.plugin.trace(t.id));
    }
  }
}

class FeedView extends CrewView {
  getViewType(): string {
    return VIEW_FEED;
  }
  getDisplayText(): string {
    return "Crew blackboard";
  }
  getIcon(): string {
    return "messages-square";
  }
  async render(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    if (this.offline(el)) return;
    const form = el.createDiv({ cls: "crew-post" });
    const input = form.createEl("input", { type: "text", placeholder: "Post to the blackboard" });
    const send = async () => {
      if (!input.value.trim()) return;
      await this.plugin.run(["post", input.value.trim()]);
      input.value = "";
    };
    btn(form, "Post", send, true);
    input.onkeydown = (e) => {
      if (e.key === "Enter") void send();
    };
    let evs: CrewEvent[] = [];
    try {
      evs = await this.plugin.get<CrewEvent[]>(`/events?since=${Date.now() - 864e5}&limit=150`);
    } catch {
      return;
    }
    const list = el.createDiv({ cls: "crew-feed" });
    for (const e of evs.reverse()) {
      const row = list.createDiv({ cls: `crew-event ${e.type === "blackboard.posted" ? "is-post" : ""}` });
      row.createSpan({ cls: "crew-time", text: new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
      row.createSpan({ cls: "crew-by", text: e.by });
      if (e.type === "blackboard.posted") row.createSpan({ text: String(e.data?.message ?? "") });
      else row.createSpan({ cls: "crew-muted", text: e.type });
      if (e.task) {
        const a = row.createEl("a", { text: e.task });
        a.onclick = () => this.plugin.openNote(`crew/tasks/${e.task}.md`);
      }
    }
  }
}

class JobsView extends CrewView {
  getViewType(): string {
    return VIEW_JOBS;
  }
  getDisplayText(): string {
    return "Crew jobs";
  }
  getIcon(): string {
    return "cpu";
  }
  async render(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    if (this.offline(el)) return;
    let jobs: Job[] = [];
    try {
      jobs = await this.plugin.get<Job[]>("/jobs");
    } catch {
      return;
    }
    el.createEl("h4", { text: "Jobs" });
    if (!jobs.length) {
      el.createEl("p", { cls: "crew-muted", text: "No jobs yet. Agents start jobs with crew job run." });
      return;
    }
    const table = el.createEl("table", { cls: "crew-table" });
    const hr = table.createEl("tr");
    for (const h of ["Job", "Status", "Agent", "Task", "Lock", "Script", ""]) hr.createEl("th", { text: h });
    for (const j of jobs.slice().reverse().slice(0, 60)) {
      const tr = table.createEl("tr");
      const a = tr.createEl("td").createEl("a", { text: j.id });
      a.onclick = () => this.plugin.openNote(`crew/jobs/${j.id}/job.md`);
      tr.createEl("td", { text: j.status });
      tr.createEl("td", { text: j.agent });
      tr.createEl("td", { text: j.task ?? "-" });
      tr.createEl("td", { text: j.lock ?? "-" });
      tr.createEl("td", { text: j.script.split("/").pop() ?? "" });
      const td = tr.createEl("td");
      if (["queued", "waiting", "running"].includes(j.status)) btn(td, "Kill", () => this.plugin.run(["job", "kill", j.id], true));
    }
  }
}

// ---------- modals ----------
class PromptModal extends Modal {
  constructor(app: App, private label: string, private onSubmit: (v: string) => Promise<void>) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.label);
    const ta = this.contentEl.createEl("textarea", { cls: "crew-textarea" });
    const row = this.contentEl.createDiv({ cls: "crew-actions" });
    btn(row, "Send", async () => {
      if (!ta.value.trim()) return;
      await this.onSubmit(ta.value.trim());
      this.close();
    }, true);
    ta.focus();
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  constructor(app: App, private message: string, private onYes: () => Promise<void>) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText("Are you sure?");
    this.contentEl.createEl("p", { text: this.message });
    const row = this.contentEl.createDiv({ cls: "crew-actions" });
    btn(row, "Stop everything", async () => {
      await this.onYes();
      this.close();
    }, true);
    btn(row, "Cancel", async () => this.close());
  }
}

class OutputModal extends Modal {
  constructor(app: App, private heading: string, private text: string) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.heading);
    this.contentEl.createEl("pre", { cls: "crew-output", text: this.text });
  }
}

class NewTaskModal extends Modal {
  constructor(app: App, private plugin: WranglerPlugin) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText("New task");
    const v = { title: "", needs: "", type: "general", accept: "", checks: "" };
    new Setting(this.contentEl).setName("Title").addText((t) => t.onChange((x) => (v.title = x)));
    new Setting(this.contentEl).setName("Needs").setDesc("Capabilities, comma separated").addText((t) => t.onChange((x) => (v.needs = x)));
    new Setting(this.contentEl).setName("Type").addDropdown((d) =>
      d.addOptions({ general: "General", asset: "Asset", docs: "Docs", code: "Code" }).setValue("general").onChange((x) => (v.type = x)),
    );
    new Setting(this.contentEl).setName("Acceptance criteria").setDesc("One per line. Required before the task is ready.").addTextArea((t) => t.onChange((x) => (v.accept = x)));
    new Setting(this.contentEl).setName("Checks").setDesc("Optional shell commands, one per line").addTextArea((t) => t.onChange((x) => (v.checks = x)));
    const row = this.contentEl.createDiv({ cls: "crew-actions" });
    btn(row, "Create task", async () => {
      if (!v.title.trim()) return new Notice("Give the task a title.");
      const argv = ["task", "new", v.title.trim(), "--type", v.type];
      if (v.needs.trim()) argv.push("--needs", v.needs.trim());
      for (const line of v.accept.split("\n").map((x) => x.trim()).filter(Boolean)) argv.push("--accept", line);
      for (const line of v.checks.split("\n").map((x) => x.trim()).filter(Boolean)) argv.push("--check", line);
      await this.plugin.run(argv, true);
      this.close();
    }, true);
  }
}

interface RunnerModelPicker {
  getRunner(): string;
  getModel(): string;
  /** The detected-runner info for whatever's currently selected, if it's a known one. */
  getInfo(): DetectedRunnerLike | undefined;
}
type DetectedRunnerLike = { id: string; label: string; models: string[] | null; configSnippet: string };

/**
 * Shared by NewAgentModal (creating) and EditAgentModal (changing an existing agent's runner/model):
 * detects installed AI CLIs, offers a live model list per runner where one exists, and falls back
 * to free text otherwise. `initialRunner`/`initialModel` seed the fields (both blank for a new agent).
 */
async function buildRunnerModelPicker(
  container: HTMLElement,
  plugin: WranglerPlugin,
  initialRunner: string,
  initialModel: string,
): Promise<RunnerModelPicker> {
  const runnerSetting = new Setting(container).setName("Runner").setDesc("Detecting installed AI tools...");
  const modelContainer = container.createDiv();
  const otherContainer = container.createDiv();

  const [configured, detected] = await Promise.all([plugin.configuredRunners(), detectRunners()]);
  const byId = new Map(detected.map((r) => [r.id, r]));
  const v = { runner: initialRunner || "dryrun", model: initialModel };

  const renderModelField = () => {
    modelContainer.empty();
    const info = byId.get(v.runner);
    if (info?.models?.length) {
      if (!info.models.includes(v.model)) v.model = info.models[0]!;
      new Setting(modelContainer).setName("Model").addDropdown((d) => {
        const opts: Record<string, string> = {};
        for (const m of info.models!) opts[m] = m;
        d.addOptions(opts).setValue(v.model).onChange((x) => (v.model = x));
      });
    } else {
      new Setting(modelContainer)
        .setName("Model")
        .setDesc(v.runner === "dryrun" ? "Not used by dryrun." : "No known model list for this runner -- type one.")
        .addText((t) => t.setValue(v.model).setPlaceholder("e.g. sonnet, gpt-5").onChange((x) => (v.model = x)));
    }
  };
  const renderOtherField = () => {
    otherContainer.empty();
    if (v.runner !== "__other") return;
    v.runner = "";
    new Setting(otherContainer)
      .setName("Custom runner")
      .setDesc("Must match a key under runners: in crew/crew.md.")
      .addText((t) => t.setValue(initialRunner).onChange((x) => (v.runner = x)));
  };

  const runnerOptions: Record<string, string> = { dryrun: "Testing (dryrun)" };
  for (const r of detected) runnerOptions[r.id] = configured.has(r.id) ? r.label : `${r.label} (not in crew.md yet)`;
  if (initialRunner && !runnerOptions[initialRunner]) runnerOptions[initialRunner] = `${initialRunner} (current)`;
  runnerOptions.__other = "Other (type manually)";
  runnerSetting.setDesc(detected.length ? "" : "No known AI CLIs found on PATH. Pick dryrun for testing, or type a custom runner.");
  runnerSetting.addDropdown((d) =>
    d.addOptions(runnerOptions).setValue(v.runner).onChange((x) => {
      v.runner = x;
      renderModelField();
      renderOtherField();
    }),
  );
  renderModelField();

  return { getRunner: () => v.runner, getModel: () => v.model, getInfo: () => byId.get(v.runner) };
}

function warnIfRunnerUnconfigured(app: App, runner: string, info: DetectedRunnerLike | undefined, configured: Set<string>): void {
  if (!info || configured.has(runner)) return;
  new OutputModal(
    app,
    `Add "${runner}" to crew.md first`,
    `crew/crew.md has no "${runner}" runner yet, so this agent can't start sessions until you add one.\n\n` +
      `Suggested, under runners: in crew/crew.md --\n\n${info.configSnippet}\n\n` +
      `Review it -- especially any approval/sandbox flags -- before saving.`,
  ).open();
}

class NewAgentModal extends Modal {
  constructor(app: App, private plugin: WranglerPlugin) {
    super(app);
  }
  async onOpen(): Promise<void> {
    this.titleEl.setText("Spawn agent");
    const v = { name: "", template: "worker", can: "" };
    new Setting(this.contentEl).setName("Name").setDesc("Lowercase, digits and dashes").addText((t) => t.onChange((x) => (v.name = x)));
    new Setting(this.contentEl).setName("Template").addDropdown((d) =>
      d.addOptions({ worker: "Worker", bridge: "Bridge", verifier: "Verifier", planner: "Planner", watcher: "Watcher", scout: "Scout" }).setValue("worker").onChange((x) => (v.template = x)),
    );

    const picker = await buildRunnerModelPicker(this.contentEl, this.plugin, "", "");
    const configured = await this.plugin.configuredRunners();

    new Setting(this.contentEl).setName("Capabilities").setDesc("Comma separated, matched against task needs").addText((t) => t.onChange((x) => (v.can = x)));
    this.contentEl.createEl("p", { cls: "crew-muted", text: "The agent starts disabled. Fill the blanks in its agent.md, then enable it from the crew sidebar." });
    const row = this.contentEl.createDiv({ cls: "crew-actions" });
    btn(row, "Spawn agent", async () => {
      if (!v.name.trim()) return new Notice("Give the agent a name.");
      const runner = picker.getRunner();
      const model = picker.getModel();
      if (!runner.trim()) return new Notice("Pick or type a runner.");
      const argv = ["agent", "new", v.name.trim(), "--template", v.template, "--runner", runner, "--can", v.can];
      if (model.trim()) argv.push("--model", model.trim());
      const r = await this.plugin.run(argv, true);
      if (r.code === 0) this.plugin.openNote(`crew/agents/${v.name.trim()}/agent.md`);
      warnIfRunnerUnconfigured(this.app, runner, picker.getInfo(), configured);
      this.close();
    }, true);
  }
}

class EditAgentModal extends Modal {
  constructor(app: App, private plugin: WranglerPlugin, private agentName: string, private currentRunner: string, private currentModel: string) {
    super(app);
  }
  async onOpen(): Promise<void> {
    this.titleEl.setText(`Edit ${this.agentName}`);
    this.contentEl.createEl("p", { cls: "crew-muted", text: `Currently ${this.currentRunner}/${this.currentModel || "-"}.` });
    const picker = await buildRunnerModelPicker(this.contentEl, this.plugin, this.currentRunner, this.currentModel);
    const configured = await this.plugin.configuredRunners();
    const row = this.contentEl.createDiv({ cls: "crew-actions" });
    btn(row, "Save", async () => {
      const runner = picker.getRunner();
      const model = picker.getModel();
      if (!runner.trim()) return new Notice("Pick or type a runner.");
      await this.plugin.run(["agent", "set", this.agentName, "--runner", runner, "--model", model], true);
      warnIfRunnerUnconfigured(this.app, runner, picker.getInfo(), configured);
      this.close();
    }, true);
  }
}

class BroadcastModal extends Modal {
  constructor(app: App, private plugin: WranglerPlugin) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText("Broadcast event");
    const v = { type: "", task: "", data: "" };
    new Setting(this.contentEl).setName("Event").setDesc("For example asset.requested").addText((t) => t.onChange((x) => (v.type = x)));
    new Setting(this.contentEl).setName("Task").setDesc("Optional task ID").addText((t) => t.onChange((x) => (v.task = x)));
    new Setting(this.contentEl).setName("Data").setDesc("Optional JSON").addTextArea((t) => t.onChange((x) => (v.data = x)));
    const row = this.contentEl.createDiv({ cls: "crew-actions" });
    btn(row, "Broadcast", async () => {
      const argv = ["emit", v.type.trim()];
      if (v.task.trim()) argv.push("--task", v.task.trim());
      if (v.data.trim()) argv.push("--data", v.data.trim());
      await this.plugin.run(argv, true);
      this.close();
    }, true);
  }
}

// ---------- settings ----------
class WranglerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WranglerPlugin) {
    super(app, plugin);
  }
  display(): void {
    const el = this.containerEl;
    el.empty();

    new Setting(el).setName("How to use Wrangler").setHeading();
    const intro = el.createDiv({ cls: "crew-muted" });
    intro.createEl("p", {
      text: "Wrangler runs crew, a team of AI agents for this vault, and shows it as views. Open them from the command palette (Cmd/Ctrl+P), search \"Wrangler\":",
    });
    const list = intro.createEl("ul");
    const row = (cmd: string, desc: string) => {
      const li = list.createEl("li");
      li.createEl("strong", { text: cmd });
      li.appendText(` -- ${desc}`);
    };
    row("Open crew sidebar", "agents, their status and spend, quick actions (also the ribbon icon)");
    row("Open board", "tasks by column, Inbox through Done; drag cards or use New task");
    row("Open review inbox", "escalated work and sampled approvals waiting on you (also the status bar)");
    row("Open blackboard feed", "the team's shared timeline; post a message from here too");
    row("Open jobs", "background jobs agents have started, running or finished");
    row("Create task / Spawn agent from template / Broadcast event", "same forms as the sidebar and board buttons");
    row("Kill switch: stop every session and job", "pauses everything; crew resume in a terminal (or the sidebar) undoes it");
    intro.createEl("p", {
      text: "Workflow: a task needs at least one acceptance criterion to leave Inbox and become Ready. An enabled agent whose capabilities match claims it, works in an isolated copy, then moves it to Verify. A verifier approves, rejects, or escalates to Review inbox for you. Tasks made from the board or command palette go through the same crew task new command a terminal would run -- they're just as valid.",
    });
    const moreDetail = intro.createEl("p");
    moreDetail.appendText("More detail: crew/board.md and crew/wiki/index.md in this vault, the crew-manager skill at crew/skills/crew-manager/SKILL.md if your copilot reads it, or the full site: ");
    moreDetail.createEl("a", { text: "roninito.github.io/crew", href: "https://roninito.github.io/crew/" });
    moreDetail.appendText(".");

    new Setting(el)
      .setName("Wrangler version")
      .setDesc(`Installed: v${this.plugin.manifest.version}`)
      .addButton((b) =>
        b.setButtonText("Check for updates").onClick(async () => {
          b.setDisabled(true);
          try {
            await this.plugin.checkForUpdates();
          } finally {
            b.setDisabled(false);
          }
        }),
      );
    new Setting(el)
      .setName("crew CLI path")
      .setDesc(
        "Advanced: only needed to run crew from a source checkout instead of Wrangler's own downloaded copy. " +
          "Path to packages/crew/bin/crew.ts. Leave blank to let Wrangler download and manage crew itself.",
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.crewCliPath).onChange(async (v) => {
          this.plugin.settings.crewCliPath = v.trim();
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
    new Setting(el)
      .setName("Bun path")
      .setDesc("Advanced: only used with crew CLI path above, to run crew.ts with Bun from source.")
      .addText((t) =>
        t.setValue(this.plugin.settings.bunPath).onChange(async (v) => {
          this.plugin.settings.bunPath = v.trim() || "bun";
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
    new Setting(el).setName("Start crew with Obsidian").setDesc("Starts the crew server when the vault opens, unless one is already running.").addToggle((t) =>
      t.setValue(this.plugin.settings.autoStart).onChange(async (v) => {
        this.plugin.settings.autoStart = v;
        await this.plugin.saveData(this.plugin.settings);
      }),
    );
    new Setting(el).setName("Refresh interval").setDesc("Seconds between status refreshes. Live events also refresh the views.").addText((t) =>
      t.setValue(String(this.plugin.settings.refreshSeconds)).onChange(async (v) => {
        this.plugin.settings.refreshSeconds = Math.max(2, Number(v) || 5);
        await this.plugin.saveData(this.plugin.settings);
      }),
    );
  }
}

// ---------- helpers ----------
function btn(parent: HTMLElement, text: string, onClick: () => Promise<unknown>, cta = false): HTMLButtonElement {
  const b = parent.createEl("button", { text, cls: cta ? "mod-cta" : "" });
  b.onclick = async () => {
    b.disabled = true;
    try {
      await onClick();
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

// An icon-only control: the icon says what it looks like, the tooltip (Obsidian's own, via
// setTooltip) says what it does. aria-label carries the same text for screen readers.
function iconBtn(
  parent: HTMLElement,
  icon: IconName,
  tooltip: string,
  onClick: () => Promise<unknown>,
  cta = false,
): HTMLButtonElement {
  const b = parent.createEl("button", { cls: `crew-icon-btn ${cta ? "mod-cta" : ""}` });
  b.innerHTML = ICONS[icon];
  b.setAttribute("aria-label", tooltip);
  setTooltip(b, tooltip);
  b.onclick = async () => {
    b.disabled = true;
    try {
      await onClick();
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

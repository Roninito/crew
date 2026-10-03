// Root layout. Two views over the same local data, no HTTP, no token:
//
// - overview (no project resolved, or Esc'd out of one): aggregated TopBar plus
//   a per-project ProjectsView -- Enter drills into the focused project.
// - project: TopBar, then Sidebar + main pane (Tabs + Board/Events/Logs),
//   then CommandBar. Esc back out to the overview.
//
// Both views poll on an interval (~1.5-2s, close to the server's own tick) and
// every write goes through in-process run(), the third caller alongside
// bin/crew.ts dispatch and the HTTP /cmd route.
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useMemo, useState } from "react";
import { STATUSES } from "../tasks";
import { AgentDetailView } from "./AgentDetail";
import { Board, boardColumns } from "./Board";
import { CommandBar, type Notice } from "./CommandBar";
import { act, loadAgentDetail, loadProjects, loadSnapshot, matches, mergeSnapshots, type ProjectOverview, type Snapshot } from "./data";
import { eventRows, EventsView } from "./EventsView";
import { filteredLogs, LogsView } from "./LogsView";
import { NewTaskForm } from "./NewTaskForm";
import { ProjectsView } from "./ProjectsView";
import { Sidebar } from "./Sidebar";
import { Tabs } from "./Tabs";
import { TopBar } from "./TopBar";
import { TaskDetail } from "./TaskDetail";
import { theme } from "./theme";
import type { Crew } from "../core";

type Pane = "board" | "agents";
type Mode =
  | { kind: "browse" }
  | { kind: "search" }
  | { kind: "detail"; taskId: string }
  | { kind: "agent"; name: string }
  | { kind: "newTask"; crew: Crew; projectId: string | null }
  | { kind: "reply"; qid: string };

const clamp = (n: number, max: number): number => Math.max(0, Math.min(Math.max(0, max - 1), n));

const PROJECT_HINTS = "↑↓ Navigate  Enter Open  a Agents  Tab Switch  N New  Esc Back  Q Quit";
const DETAIL_HINTS = "A/R/D/C/E/M/N  actions · Enter confirm · Esc back · Q quit";
const REPLY_HINTS = "Enter send · Esc cancel";
const FORM_HINTS = "Tab next · Enter submit · Esc cancel";
const AGENT_HINTS = "↑↓ Scroll  Tab section  Esc back · edit via crew agent edit/memory";
const OVERVIEW_HINTS = "↑↓ Navigate  Enter Open  N New  Q Quit";

// Space reserved for TopBar, Tabs/section header, CommandBar, and margins.
const TOPBAR_H = 3; // border box is 3 rows
const COMMAND_H = 3; // border box + optional notice line handled separately
const TAB_H = 1;
const MARGIN = 1;
const VIEWPORT_OVERHEAD = TOPBAR_H + TAB_H + MARGIN + COMMAND_H;

export function App({ initial }: { initial: Crew | null }): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // null = all-projects overview; non-null = drilled into one project.
  const [project, setProject] = useState<Crew | null>(initial);
  const [projectId, setProjectId] = useState<string | null>(initial ? (process.env.CREW_PROJECT ?? initial.vault) : null);
  const [snap, setSnap] = useState<Snapshot | null>(() => (initial ? loadSnapshot(initial) : null));
  const [projects, setProjects] = useState<ProjectOverview[]>(() => (initial ? [] : loadProjects()));
  const [tab, setTab] = useState(0);
  const [col, setCol] = useState(0);
  const [row, setRow] = useState(0);
  const [evFocus, setEvFocus] = useState(0);
  const [logFocus, setLogFocus] = useState(-1);
  const [projFocus, setProjFocus] = useState(0);
  const [agentFocus, setAgentFocus] = useState(0);
  const [agentSection, setAgentSection] = useState(0);
  const [agentLine, setAgentLine] = useState(0);
  const [pane, setPane] = useState<Pane>("board");
  const [mode, setMode] = useState<Mode>({ kind: "browse" });
  const [query, setQuery] = useState("");
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const projectKey = projectId ?? "all";
  useEffect(() => {
    const tick = () => {
      if (project) setSnap(loadSnapshot(project));
      else setProjects(loadProjects());
    };
    const t = setInterval(tick, project ? 1500 : 2000);
    return () => clearInterval(t);
  }, [project, projectKey, projectId]);

  const drillIn = (c: Crew, id: string) => {
    setProject(c);
    setProjectId(id);
    setSnap(loadSnapshot(c));
    setMode({ kind: "browse" });
    setQuery("");
    setRow(0);
    setCol(0);
    setEvFocus(0);
    setAgentFocus(0);
    setPane("board");
  };
  const drillOut = () => {
    setProject(null);
    setProjectId(null);
    setProjects(loadProjects());
    setMode({ kind: "browse" });
    setQuery("");
    setProjFocus(0);
  };

  const visibleProjects = useMemo(
    () => projects.filter((p) => matches(query, p.entry.id, p.entry.path)),
    [projects, query],
  );
  const merged = useMemo(() => mergeSnapshots(projects), [projects]);

  const columns = useMemo(() => boardColumns(snap?.tasks ?? [], query), [snap, query]);
  const rows = useMemo(() => (snap ? eventRows(snap, query) : []), [snap, query]);
  const lines = useMemo(() => (snap ? filteredLogs(snap, query) : []), [snap, query]);

  const doAct = async (c: Crew, argv: string[]) => {
    const r = await act(c, argv);
    setNotice(r);
    if (project) setSnap(loadSnapshot(project));
    else setProjects(loadProjects());
  };

  useInput((input, key) => {
    if (mode.kind === "newTask" || mode.kind === "detail") return;
    if (mode.kind === "agent") {
      if (key.escape) {
        setMode({ kind: "browse" });
        setPane("agents");
        return;
      }
      if (key.tab) {
        setAgentSection((s) => (s + 1) % 3);
        setAgentLine(0);
        return;
      }
      const lines =
        agentSection === 0
          ? detailAgent?.raw.split("\n").length ?? 0
          : agentSection === 1
          ? detailAgent?.memory.split("\n").length ?? 0
          : detailAgent?.logLines.length ?? 0;
      if (key.upArrow || input === "k") setAgentLine((l) => Math.max(0, l - 1));
      else if (key.downArrow || input === "j") setAgentLine((l) => clamp(l + 1, lines));
      return;
    }
    if (mode.kind === "reply") {
      if (key.escape) setMode({ kind: "browse" });
      return;
    }
    if (mode.kind === "search") {
      if (key.escape) {
        setQuery("");
        setMode({ kind: "browse" });
      }
      return;
    }
    if (input === "q") return exit();
    if (input === ":") return setMode({ kind: "search" });
    if (!project) {
      if (key.escape) return;
      if (key.tab) return;
      if (input === "n") {
        const p = visibleProjects[clamp(projFocus, visibleProjects.length)];
        if (!p) return setNotice({ ok: false, text: "No project to add the task to. Run crew init first." });
        if (!p.snap) return setNotice({ ok: false, text: `Can't add a task to ${p.entry.id}: ${p.error}` });
        return setMode({ kind: "newTask", crew: p.crew, projectId: p.entry.id });
      }
      if (key.upArrow || input === "k") setProjFocus((f) => clamp(f - 1, visibleProjects.length));
      else if (key.downArrow || input === "j") setProjFocus((f) => clamp(f + 1, visibleProjects.length));
      else if (key.return) {
        const p = visibleProjects[clamp(projFocus, visibleProjects.length)];
        if (p?.snap) drillIn(p.crew, p.entry.id);
        else if (p) setNotice({ ok: false, text: `Can't open ${p.entry.id}: ${p.error}` });
      }
      return;
    }
    if (key.escape) return drillOut();

    // Agent sidebar focus toggles with 'a'.  When focused, arrow keys move
    // through agents and Enter opens the agent detail pane.
    if (input === "a") {
      setPane((p) => (p === "agents" ? "board" : "agents"));
      return;
    }
    if (pane === "agents") {
      const agents = snap?.status.agents ?? [];
      if (key.upArrow || input === "k") setAgentFocus((f) => clamp(f - 1, agents.length));
      else if (key.downArrow || input === "j") setAgentFocus((f) => clamp(f + 1, agents.length));
      else if (key.return) {
        const a = agents[clamp(agentFocus, agents.length)];
        if (a) {
          setAgentSection(0);
          setAgentLine(0);
          setMode({ kind: "agent", name: a.name });
        }
      }
      return;
    }

    if (key.tab) return setTab((t) => (t + 1) % 3);
    if (input === "n") return setMode({ kind: "newTask", crew: project, projectId: null });
    if (tab === 0) {
      const cards = columns[col] ?? [];
      if (key.leftArrow) {
        setCol((x) => (x + STATUSES.length - 1) % STATUSES.length);
        setRow(0);
      } else if (key.rightArrow) {
        setCol((x) => (x + 1) % STATUSES.length);
        setRow(0);
      } else if (key.upArrow || input === "k") setRow((r) => clamp(r - 1, cards.length));
      else if (key.downArrow || input === "j") setRow((r) => clamp(r + 1, cards.length));
      else if (key.return) {
        const t = cards[clamp(row, cards.length)];
        if (t) setMode({ kind: "detail", taskId: t.id });
      }
    } else if (tab === 1) {
      if (key.upArrow || input === "k") setEvFocus((f) => clamp(f - 1, rows.length));
      else if (key.downArrow || input === "j") setEvFocus((f) => clamp(f + 1, rows.length));
      else if (key.return) {
        const r = rows[clamp(evFocus, rows.length)];
        if (r?.kind === "question") {
          setReply("");
          setMode({ kind: "reply", qid: r.id });
        }
      }
    } else {
      if (key.upArrow || input === "k") setLogFocus((f) => Math.max(0, (f < 0 ? lines.length - 1 : f) - 1));
      else if (key.downArrow || input === "j") setLogFocus((f) => (f < 0 ? lines.length - 1 : clamp(f + 1, lines.length)));
    }
  });

  const closeForm = () => setMode({ kind: "browse" });
  const submitNewTask = (target: Crew, f: { title: string; needs: string; accept: string; type: string }) => {
    const argv = ["task", "new", f.title];
    if (f.needs.trim()) argv.push("--needs", f.needs.trim());
    if (f.accept.trim()) argv.push("--accept", f.accept.trim());
    argv.push("--type", f.type.trim() || "general");
    setMode({ kind: "browse" });
    void doAct(target, argv);
  };

  const detailTask =
    mode.kind === "detail" && snap ? (snap.tasks.find((t) => t.id === mode.taskId) ?? null) : null;
  const detailAgent =
    mode.kind === "agent" && project
      ? (() => {
          try {
            return loadAgentDetail(project, mode.name);
          } catch {
            return null;
          }
        })()
      : null;

  const termRows = stdout?.rows ?? 24;
  const termCols = stdout?.columns ?? 80;
  const sidebarW = 22;
  const mainW = Math.max(40, termCols - sidebarW - 2);
  const mainH = Math.max(8, termRows - VIEWPORT_OVERHEAD);

  if (!project) {
    const target = mode.kind === "newTask" ? mode : null;
    return (
      <Box flexDirection="column" width="100%" height={termRows}>
        <TopBar snap={merged} projectId={null} />
        <Box flexGrow={1} height={mainH}>
          {target ? (
            <Box flexDirection="column" flexGrow={1}>
              <Text color={theme.dim}>
                New task in <Text color={theme.accent}>{target.projectId}</Text>
              </Text>
              <NewTaskForm onCancel={closeForm} onSubmit={(f) => submitNewTask(target.crew, f)} />
            </Box>
          ) : (
            <ProjectsView items={visibleProjects} focus={clamp(projFocus, visibleProjects.length)} height={mainH} />
          )}
        </Box>
        <CommandBar
          searching={mode.kind === "search"}
          query={query}
          onQuery={setQuery}
          onDone={() => setMode({ kind: "browse" })}
          notice={notice}
          hints={OVERVIEW_HINTS}
          prompt="search projects"
        />
      </Box>
    );
  }

  if (!snap) return <Box />;
  return (
    <Box flexDirection="column" width="100%" height={termRows}>
      <TopBar snap={snap} projectId={projectId} />
      <Box flexGrow={1} height={mainH}>
        <Sidebar snap={snap} focus={clamp(agentFocus, snap.status.agents.length)} />
        <Box flexDirection="column" flexGrow={1} marginLeft={1} width={mainW} height={mainH} flexShrink={0}>
          <Tabs snap={snap} active={tab} />
          {mode.kind === "newTask" ? (
            <NewTaskForm onCancel={closeForm} onSubmit={(f) => submitNewTask(mode.crew, f)} />
          ) : mode.kind === "reply" ? (
            <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor={theme.accent} paddingX={1} height={mainH}>
              <Text bold color={theme.accent}>
                ANSWER {mode.qid} (Enter to send, Esc to cancel)
              </Text>
              <TextInput
                value={reply}
                onChange={setReply}
                placeholder="your answer; the asking agent wakes on it"
                onSubmit={(text) => {
                  if (!text.trim()) return;
                  const qid = mode.qid;
                  setMode({ kind: "browse" });
                  void doAct(project, ["question", "answer", qid, text.trim()]);
                }}
              />
            </Box>
          ) : mode.kind === "detail" && detailTask ? (
            <TaskDetail task={detailTask} submit={(argv) => void doAct(project, argv)} close={() => setMode({ kind: "browse" })} />
          ) : mode.kind === "agent" && detailAgent ? (
            <AgentDetailView detail={detailAgent} height={mainH - TAB_H} section={agentSection} focusLine={agentLine} />
          ) : tab === 0 ? (
            <Board columns={columns} col={col} row={clamp(row, (columns[col] ?? []).length)} width={mainW} height={mainH - TAB_H} />
          ) : tab === 1 ? (
            <EventsView rows={rows} focus={clamp(evFocus, rows.length)} height={mainH - TAB_H} />
          ) : (
            <LogsView lines={lines} focus={logFocus < 0 ? lines.length - 1 : clamp(logFocus, lines.length)} height={mainH - TAB_H} />
          )}
        </Box>
      </Box>
      <CommandBar
        searching={mode.kind === "search"}
        query={query}
        onQuery={setQuery}
        onDone={() => setMode({ kind: "browse" })}
        notice={notice}
        hints={
          mode.kind === "detail" && detailTask
            ? DETAIL_HINTS
            : mode.kind === "agent"
            ? AGENT_HINTS
            : mode.kind === "reply"
            ? REPLY_HINTS
            : mode.kind === "newTask"
            ? FORM_HINTS
            : PROJECT_HINTS
        }
      />
    </Box>
  );
}

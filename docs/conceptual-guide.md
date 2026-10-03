# Conceptual Guide: Agents, Agent Packs, and the Crew + Wrangler System

## The Big Picture

Most development workflows rely on a human doing everything: planning, coding, testing, reviewing, deploying, and documenting. As projects grow, the cognitive load becomes the bottleneck. **Crew + Wrangler flips this model.**

Instead of you doing the work, you **direct a team of specialized agents** that work continuously, in parallel, with full traceability. You stay in the loop for judgment calls, but the mechanical execution happens without you.

---

## What Changes When You Add Agents

### From Sequential to Parallel

**Traditional:** You plan → you code → you test → you review → you deploy. One thing at a time, blocked by your attention.

**With Crew:** Multiple agents claim tasks simultaneously. A *planner* breaks a feature into tasks. A *worker* writes code in an isolated worktree. A *verifier* checks it against acceptance criteria. A *tester* runs the test suite. They all run independently, waking only when their input is ready.

### From Memory to Institutional Knowledge

**Traditional:** Knowledge lives in your head, Slack threads, or scattered docs that drift from reality.

**With Crew:** Every decision, every check, every file produced is recorded in the task itself. The *wiki* captures conventions that agents read before working. The *verifier* enforces them. New agents (or new humans) inherit the project's accumulated wisdom instantly by reading the wiki — no onboarding interviews needed.

### From "Did It Work?" to "Show Me the Trail"

**Traditional:** You finish a feature, maybe write a commit message, hope the PR description explains it.

**With Crew:** `crew trace T-0142` generates a complete timeline: what triggered the task, which agent claimed it, what jobs ran, what events fired, what the verifier checked, what the human approved, and every file produced. Audits are instant because the trail was written *as the work happened*.

---

## What Agent Packs Give You

### A Team in a Box

An **agent pack** is a pre-designed team for a specific domain. Instead of designing agents from scratch, you install a pack and get:

- **Asset Pipeline** → 3D artists (modeler, imager, sheeter, planner) that take a concept to a game-ready GLB
- **Content Pipeline** → Researchers, drafters, fact-checkers, polishers that take a brief to a published article
- **Web Experience** → Briefer, builder, motion designer that take a brief to an interactive page
- **Code Maintenance** → Triager, reproducer, fixer, tester that turn bug reports into verified fixes
- **Release** → Releaser that versions, changelogs, checks, and publishes with human gates

### Composability Without Conflict

Packs use **capability tags** (`can: [blender, mesh]`) to claim tasks. Two packs can coexist because they tag different capabilities. A "web-experience" agent never claims a "model3d" task. You combine packs like LEGO — the board routes work to whoever has the right tag.

### Zero Configuration for External Dependencies

Packs don't hardcode API keys, endpoints, or commands. Those live in environment variables documented in the pack's wiki page. Switching from Hugging Face to Replicate, or from Playwright to Puppeteer, means editing one `.env` line — not rewriting agents.

---

## How Wrangler Keeps You in Control

### The Dashboard You Actually Look At

Wrangler runs inside Obsidian (your notes, your context) and shows:

- **Crew Sidebar:** Every agent's status, current task, last log line, today's spend
- **Board:** Kanban view — drag tasks, claim as human, see claim timers
- **Review Inbox:** Only the judgment calls that need you (verifier escalations, sampled approvals, agent questions)
- **Status Bar:** One-line pulse: "3 running · 2 sleeping · 1 needs review · $1.40 today"

You don't babysit. You glance, you decide, you move on.

### Human Gates, Not Human Grind

Agents **never ask permission to act**. They work in isolated worktrees. The verifier approves 90%+ automatically. You only see:
- Verifier escalations (low confidence, subjective criteria, protected areas)
- Random samples (1 in 10 auto-approvals, to keep the verifier honest)
- Agent questions (open-ended judgment calls mid-task)

Your attention goes to *decisions*, not *execution*.

---

## The Productivity Multiplier

| Before Crew + Wrangler | After Crew + Wrangler |
|------------------------|----------------------|
| You write every line | You write the *acceptance criteria*; agents write the code |
| You remember conventions | The wiki remembers; agents read it before every task |
| You context-switch constantly | Agents context-switch; you stay in flow |
| Bugs found in production | Verifier catches them at the task level |
| Deploy anxiety | Release agent handles versioning, changelogs, checks, gates |
| Knowledge leaves with people | Knowledge accumulates in tasks, wiki, traces |
| "Who did what?" | `crew trace` answers instantly |

---

## How to Start

1. **Pick a domain** where you have recurring work (assets, content, bugs, releases, web pages).
2. **Install the matching pack** — one command, zero design work.
3. **Create your first task** with clear acceptance criteria.
4. **Watch it move** on the board. Answer the review gates.
5. **Add a second pack** when the first one feels natural. They share the same board, same traceability, same verbs.

---

## The Mental Model Shift

**Stop thinking:** "How do I get this done?"
**Start thinking:** "What does *done* look like, and which capability tags does it need?"

The agents handle the *how*. You define the *what* and the *bar*. The system handles the rest — parallelism, isolation, verification, traceability, budgets, and the dashboard that lets you sleep while the work continues.

That's the productivity gain: **you become the architect, not the builder.**
// Pure logic Wrangler's UI depends on, kept free of the "obsidian" import so it can be unit
// tested directly with `bun test` -- no plugin instance, no mocked Obsidian API required.
import { spawn } from "node:child_process";
import { parse as parseYaml } from "yaml";

// ---------- AI CLI detection for the spawn-agent form ----------
// Detection and model lists are only as good as what each tool documents today; this is a
// convenience for the dropdown, not a guarantee. Verify the crew.md runner config it suggests
// before enabling an agent, especially any approval/sandbox flags a runner needs to run unattended.
// Only claude and opencode are offered today -- codex and cursor were pulled after a first pass
// because their unattended-safe invocation flags (approval/sandbox bypass) aren't confidently
// known, and a wrong guess there is worse than no suggestion at all.
export interface RunnerProbe {
  id: string;
  label: string;
  checkCmd: string;
  verify?: (output: string) => boolean;
  staticModels: string[] | null;
  liveModelsCmd?: string;
  configSnippet: string;
}

export const RUNNER_PROBES: RunnerProbe[] = [
  {
    id: "claude",
    label: "Claude Code",
    checkCmd: "claude --version",
    staticModels: ["sonnet", "opus", "haiku"],
    configSnippet:
      '  claude:\n    cmd: claude\n    args: ["-p", "{{prompt}}", "--model", "{{model}}", "--output-format", "json", "--permission-mode", "acceptEdits"]\n    cost_from_json: true',
  },
  {
    id: "opencode",
    label: "opencode",
    checkCmd: "opencode --version",
    staticModels: null,
    liveModelsCmd: "opencode models",
    configSnippet: '  opencode:\n    cmd: opencode\n    args: ["run", "--model", "{{model}}", "{{prompt}}"]',
  },
];

export interface DetectedRunner {
  id: string;
  label: string;
  models: string[] | null;
  configSnippet: string;
}

export function runCapture(cmd: string, timeoutMs = 5000): Promise<{ code: number; out: string; stdout: string }> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    // Obsidian is launched by the GUI (Dock/Spotlight/launchd), not from a terminal, so it starts
    // with a minimal PATH -- none of the additions a user's shell rc file makes. -i (interactive)
    // is what actually gets zsh to read ~/.zshrc (a login shell alone reads ~/.zprofile instead,
    // which is often empty); -l covers bash users whose PATH lives in ~/.bash_profile.
    const child = isWin
      ? spawn("cmd.exe", ["/d", "/c", cmd], { windowsHide: true })
      : spawn(process.env.SHELL || "/bin/zsh", ["-ilc", cmd]);
    let out = "";
    let stdout = "";
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out, stdout });
    };
    child.stdout?.on("data", (d) => {
      const s = String(d);
      out += s;
      stdout += s;
    });
    child.stderr?.on("data", (d) => (out += String(d)));
    child.on("close", (code) => finish(code ?? 1));
    child.on("error", () => finish(1));
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish(1);
    }, timeoutMs);
  });
}

/** provider/model, provider/vendor/model, etc. -- one or more slash-separated segments. */
export function parseModelList(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+(?:\/[\w.:-]+)+$/.test(l));
}

export async function detectRunners(probes: RunnerProbe[] = RUNNER_PROBES): Promise<DetectedRunner[]> {
  const results = await Promise.all(
    probes.map(async (probe): Promise<DetectedRunner | null> => {
      const res = await runCapture(probe.checkCmd);
      if (res.code !== 0) return null;
      if (probe.verify && !probe.verify(res.out)) return null;
      let models = probe.staticModels;
      if (probe.liveModelsCmd) {
        const live = await runCapture(probe.liveModelsCmd);
        if (live.code === 0) {
          const parsed = parseModelList(live.out);
          if (parsed.length) models = parsed;
        }
      }
      return { id: probe.id, label: probe.label, models, configSnippet: probe.configSnippet };
    }),
  );
  return results.filter((r): r is DetectedRunner => r !== null);
}

// ---------- versioning ----------
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

// ---------- release assets ----------
export function platformAssetName(platform: string, arch: string): string | null {
  if (platform === "darwin" && arch === "arm64") return "crew-darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "crew-darwin-x64";
  if (platform === "linux" && arch === "arm64") return "crew-linux-arm64";
  if (platform === "linux" && arch === "x64") return "crew-linux-x64";
  if (platform === "win32" && arch === "x64") return "crew-windows-x64.exe";
  return null;
}

// ---------- crew.md ----------
/** Runner ids already configured under runners: in crew.md's frontmatter. */
export function parseRunnersFromFrontmatter(raw: string): Set<string> {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return new Set();
  try {
    const data = parseYaml(fm[1]) as { runners?: Record<string, unknown> };
    return new Set(Object.keys(data.runners ?? {}));
  } catch {
    return new Set();
  }
}

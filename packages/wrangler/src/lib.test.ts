import { describe, expect, test } from "bun:test";
import {
  RUNNER_PROBES,
  detectRunners,
  isNewerVersion,
  parseModelList,
  parseRunnersFromFrontmatter,
  platformAssetName,
  runCapture,
} from "./lib";

describe("isNewerVersion", () => {
  test("equal versions are not newer", () => {
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
  });
  test("patch bump", () => {
    expect(isNewerVersion("1.2.4", "1.2.3")).toBe(true);
    expect(isNewerVersion("1.2.3", "1.2.4")).toBe(false);
  });
  test("minor and major bumps outrank patch", () => {
    expect(isNewerVersion("1.3.0", "1.2.9")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
  });
  test("missing segments default to 0", () => {
    expect(isNewerVersion("1.1", "1.0.5")).toBe(true);
    expect(isNewerVersion("1.0", "1.0.0")).toBe(false);
  });
});

describe("platformAssetName", () => {
  test("known platform/arch pairs", () => {
    expect(platformAssetName("darwin", "arm64")).toBe("crew-darwin-arm64");
    expect(platformAssetName("darwin", "x64")).toBe("crew-darwin-x64");
    expect(platformAssetName("linux", "arm64")).toBe("crew-linux-arm64");
    expect(platformAssetName("linux", "x64")).toBe("crew-linux-x64");
    expect(platformAssetName("win32", "x64")).toBe("crew-windows-x64.exe");
  });
  test("unrecognized platform/arch returns null", () => {
    expect(platformAssetName("sunos", "sparc")).toBeNull();
    expect(platformAssetName("win32", "arm64")).toBeNull();
  });
});

describe("parseModelList", () => {
  test("parses simple provider/model lines", () => {
    const out = "opencode/claude-sonnet-5\nopencode/claude-opus-5\n";
    expect(parseModelList(out)).toEqual(["opencode/claude-sonnet-5", "opencode/claude-opus-5"]);
  });
  test("parses multi-segment provider/vendor/model lines", () => {
    const out = "vercel/alibaba/qwen3-coder\nollama-cloud/nemotron-3-nano:30b\n";
    expect(parseModelList(out)).toEqual(["vercel/alibaba/qwen3-coder", "ollama-cloud/nemotron-3-nano:30b"]);
  });
  test("ignores blank lines and lines without a slash", () => {
    const out = "\n  \nsome header text\nopencode/big-pickle\n";
    expect(parseModelList(out)).toEqual(["opencode/big-pickle"]);
  });
  test("empty output yields no models", () => {
    expect(parseModelList("")).toEqual([]);
  });
});

describe("parseRunnersFromFrontmatter", () => {
  test("extracts runner ids from valid frontmatter", () => {
    const raw = [
      "---",
      "vault_name: \"Test\"",
      "runners:",
      "  claude:",
      "    cmd: claude",
      "    args: []",
      "  opencode:",
      "    cmd: opencode",
      "    args: []",
      "---",
      "",
      "# Crew settings",
    ].join("\n");
    expect(parseRunnersFromFrontmatter(raw)).toEqual(new Set(["claude", "opencode"]));
  });
  test("no runners key yields an empty set", () => {
    const raw = "---\nvault_name: \"Test\"\n---\n";
    expect(parseRunnersFromFrontmatter(raw)).toEqual(new Set());
  });
  test("missing frontmatter entirely yields an empty set", () => {
    expect(parseRunnersFromFrontmatter("# just a note, no frontmatter")).toEqual(new Set());
  });
  test("malformed YAML doesn't throw", () => {
    const raw = "---\nrunners: [this is not: valid: yaml\n---\n";
    expect(parseRunnersFromFrontmatter(raw)).toEqual(new Set());
  });
});

describe("runCapture", () => {
  test("captures stdout and exit code from a successful command", async () => {
    // Asserting on the LAST line, not the whole trimmed blob: an interactive login shell can
    // print its own startup noise before our command runs (iTerm2's shell integration does, on
    // this machine) -- this is exactly the failure mode that made resolveLoginPath's original
    // implementation (main.ts) silently corrupt PATH by taking the whole blob. Any caller of
    // runCapture needs to be robust to this, not just resolveLoginPath.
    const res = await runCapture("echo hello");
    expect(res.code).toBe(0);
    expect(res.stdout.trim().split("\n").at(-1)).toBe("hello");
  });
  test("reports a non-zero exit code", async () => {
    const res = await runCapture("exit 3");
    expect(res.code).toBe(3);
  });
  test("times out a hanging command", async () => {
    const res = await runCapture("sleep 5", 200);
    expect(res.code).not.toBe(0);
  });
});

describe("detectRunners", () => {
  test("skips probes whose command isn't found, without throwing", async () => {
    const result = await detectRunners([
      { id: "nope", label: "Nope", checkCmd: "definitely-not-a-real-command-xyz --version", staticModels: null, configSnippet: "" },
    ]);
    expect(result).toEqual([]);
  });
  test("applies the verify guard to reject a false-positive match", async () => {
    // "echo" always succeeds, so this probe would false-positive on any host without a guard;
    // the guard rejects it because the output never contains "definitely-absent-marker".
    const result = await detectRunners([
      {
        id: "guarded",
        label: "Guarded",
        checkCmd: "echo not-the-right-tool",
        verify: (out) => out.includes("definitely-absent-marker"),
        staticModels: null,
        configSnippet: "",
      },
    ]);
    expect(result).toEqual([]);
  });
  test("RUNNER_PROBES only offers claude and opencode", () => {
    expect(RUNNER_PROBES.map((p) => p.id).sort()).toEqual(["claude", "opencode"]);
  });
});

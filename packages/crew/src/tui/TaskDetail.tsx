// Task detail pane: full task state plus the contextual write actions, every one
// through run() in-process (claim, verdict approve/reject, verdict agree/disagree,
// and inbox grooming: add acceptance criteria or move to ready).
// Rejections and disagreements need a reason, collected in an inline input.
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";
import type { Task } from "../tasks";
import { theme } from "./theme";

type ReasonKind = "reject" | "disagree";
type InlineKind = ReasonKind | "accept" | "note";

export function TaskDetail({
  task,
  submit,
  close,
}: {
  task: Task;
  submit: (argv: string[]) => void;
  close: () => void;
}): React.JSX.Element {
  const [inlineFor, setInlineFor] = useState<InlineKind | null>(null);
  const [inlineText, setInlineText] = useState("");

  const reviewable = task.status === "review";
  const verifyHuman = task.status === "verify";
  const sampled = task.sampled && !task.sampled_ack;
  const claimable = task.status === "ready";
  const inbox = task.status === "inbox";
  const blocked = task.status === "blocked";

  const commit = () => {
    const text = inlineText.trim();
    if (!text) return;
    switch (inlineFor) {
      case "accept":
        submit(["task", "update", task.id, "--accept", text]);
        break;
      case "note":
        submit(["task", "update", task.id, "--note", text]);
        break;
      case "reject":
        submit(["verdict", task.id, "reject", "--reason", text]);
        break;
      case "disagree":
        submit(["verdict", task.id, "disagree", "--reason", text]);
        break;
    }
    setInlineFor(null);
    setInlineText("");
  };

  useInput((input, key) => {
    if (inlineFor) {
      if (key.escape) {
        setInlineFor(null);
        setInlineText("");
      }
      return;
    }
    if (key.escape) close();
    else if (input === "a" && (reviewable || sampled || verifyHuman)) submit(["verdict", task.id, reviewable || verifyHuman ? "approve" : "agree"]);
    else if (input === "r" && reviewable) setInlineFor("reject");
    else if (input === "d" && sampled) setInlineFor("disagree");
    else if (input === "c" && claimable) submit(["claim", task.id]);
    else if (input === "e" && (inbox || blocked)) setInlineFor("accept");
    else if (input === "m" && (inbox || blocked)) {
      if (!task.acceptance.length) {
        // Can't leave inbox without criteria; open the accept editor inline.
        setInlineFor("accept");
        return;
      }
      submit(["task", "update", task.id, "--status", "ready"]);
    }
    else if (input === "n") setInlineFor("note");
  });

  const inlineLabel: Record<InlineKind, string> = {
    reject: `Reason to reject (required, Enter to send, Esc to cancel):`,
    disagree: `Reason to disagree (required, Enter to send, Esc to cancel):`,
    accept: `Add acceptance criterion (Enter to add, Esc to cancel):`,
    note: `Add a note (Enter to add, Esc to cancel):`,
  };

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor={theme.accent} paddingX={1}>
      <Text bold>
        <Text color={theme.accent}>{task.id}</Text>
        <Text> {task.title}</Text>
      </Text>
      <Text color={theme.dim}>
        {task.status} · owner {task.claimed_by ?? "-"} · type {task.type} · needs {task.needs.join(",") || "-"}
        {task.protected ? " · PROTECTED" : ""}
        {sampled ? " · SAMPLED for human review" : ""}
      </Text>
      {task.recommendation ? <Text color={theme.warn}>verifier recommends: {task.recommendation}</Text> : null}
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.dim} bold>
          ACCEPTANCE
        </Text>
        {task.acceptance.length === 0 ? (
          <Text color={theme.faint}>(none -- stays in inbox until criteria are added)</Text>
        ) : (
          task.acceptance.map((a, i) => <Text key={i}>- {a}</Text>)
        )}
      </Box>
      {inlineFor ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.warn} bold>
            {inlineLabel[inlineFor]}
          </Text>
          <TextInput
            value={inlineText}
            onChange={setInlineText}
            onSubmit={commit}
            placeholder={inlineFor === "accept" ? "what done looks like" : "what the worker should know"}
          />
        </Box>
      ) : (
        <Box marginTop={1} columnGap={2} flexWrap="wrap">
          {reviewable || verifyHuman ? <Text color={theme.accent} bold>[a]pprove</Text> : null}
          {reviewable ? <Text color={theme.live} bold>[r]eject</Text> : null}
          {sampled && !reviewable ? <Text color={theme.accent} bold>[a]gree</Text> : null}
          {sampled ? <Text color={theme.live} bold>[d]isagree</Text> : null}
          {claimable ? <Text color={theme.accent} bold>[c]laim</Text> : null}
          {inbox || blocked ? <Text color={theme.accent} bold>[e] acceptance</Text> : null}
          {inbox || blocked ? <Text color={theme.accent} bold>[m] move to ready</Text> : null}
          <Text color={theme.dim} bold>[n]ote</Text>
          <Text color={theme.faint}>[Esc] back</Text>
        </Box>
      )}
    </Box>
  );
}

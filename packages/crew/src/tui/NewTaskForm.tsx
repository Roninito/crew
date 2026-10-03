// New-task form: title, needs, one acceptance criterion, type. Tab moves between
// fields, Enter anywhere submits. Without --accept the task lands in inbox;
// the hint says so up front.
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";
import { theme } from "./theme";

export type NewTaskFields = { title: string; needs: string; accept: string; type: string };

const FIELDS: { key: keyof NewTaskFields; label: string; hint: string }[] = [
  { key: "title", label: "Title", hint: "what needs doing" },
  { key: "needs", label: "Needs", hint: "comma-separated capabilities (blank = none)" },
  { key: "accept", label: "Accept", hint: "one acceptance criterion (blank = inbox)" },
  { key: "type", label: "Type", hint: "general, asset, docs or code" },
];

export function NewTaskForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (f: NewTaskFields) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [values, setValues] = useState<NewTaskFields>({ title: "", needs: "", accept: "", type: "general" });
  const [at, setAt] = useState(0);

  useInput((_, key) => {
    if (key.escape) onCancel();
    else if (key.tab) setAt((a) => (a + 1) % FIELDS.length);
    else if (key.upArrow) setAt((a) => (a + FIELDS.length - 1) % FIELDS.length);
    else if (key.downArrow) setAt((a) => (a + 1) % FIELDS.length);
  });

  const done = () => {
    if (values.title.trim()) onSubmit({ ...values, title: values.title.trim() });
  };

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor={theme.accent} paddingX={1}>
      <Text bold color={theme.accent}>
        NEW TASK
      </Text>
      {FIELDS.map((f, i) => (
        <Box key={f.key} marginTop={1} flexDirection="column">
          <Text color={i === at ? theme.text : theme.dim} bold={i === at}>
            {f.label}
            {i === at ? "" : `  ${values[f.key] || `(${f.hint})`}`}
          </Text>
          {i === at ? (
            <TextInput
              value={values[f.key]}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
              onSubmit={done}
              placeholder={f.hint}
            />
          ) : null}
        </Box>
      ))}
      <Box marginTop={1} columnGap={2}>
        <Text color={theme.faint}>[Tab] next field · [Enter] create · [Esc] cancel</Text>
      </Box>
    </Box>
  );
}

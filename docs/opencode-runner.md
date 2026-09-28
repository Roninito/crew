# Using opencode as a crew runner

How to point crew agents at opencode instead of Claude Code. The `runner:` field in an
`agent.md` is just a key into the `runners:` table in `crew/crew.md` -- crew shells out
to that runner's `cmd` with the wake prompt templated into its `args`.

## runner field values

Use exactly one of these (it must match a key under `runners:` in `crew/crew.md`,
otherwise `crew agent lint` fails):

| `runner:` value | What it runs | `model:` format |
| --- | --- | --- |
| `opencode` | `opencode run --model <model> <prompt>` | Full opencode model id, `provider/model` -- e.g. `opencode/claude-sonnet-5`. List yours with `opencode models`. |
| `claude` | `claude -p <prompt> --model <model> ... --permission-mode bypassPermissions` | Short alias: `sonnet`, `opus`, `haiku` |
| `dryrun` | `true` (does nothing) | anything (conventionally `none`); for smoke tests |
| `none` | Skips the session entirely | anything; for agents that should never wake a runner |
| `<custom>` | Whatever you add to `crew.md` (see below) | Whatever that runner expects |

The stock `crew.md` ships the first three. `none` is built into crew, not `crew.md`.

## Switching an agent to opencode

```bash
crew agent set <name> --runner opencode --model opencode/claude-sonnet-5
crew agent lint <name>   # checks the runner exists in crew.md and its cmd is on PATH
```

This edits only the two frontmatter lines, leaving directives and formatting untouched.
The asset-pipeline pack already ships all four agents on `runner: opencode` with
`model: opencode/claude-sonnet-5`.

## Model ids for opencode

`opencode models` prints the live list on this machine (it changes as providers come
and go -- don't hardcode it anywhere but an agent's `model:` line). Current
Claude-family ids include:

```
opencode/claude-sonnet-5
opencode/claude-sonnet-5-5
opencode/claude-opus-5
opencode/claude-opus-5-5
opencode/claude-haiku-4-5
```

Keep the verifier pattern when it matters: workers on a sonnet-class model, anything
doing verification on opus (different model from the worker whose work it checks).

## Kimi models

Same thing -- `runner: opencode`, with a Kimi model id:

```yaml
runner: opencode
model: opencode/kimi-k3
```

Other Kimi ids on this machine: `opencode/kimi-k2.5`, `opencode/kimi-k2.6`,
`opencode/kimi-k2.7-code` (code specialist), plus the same family via other providers
(`ollama-cloud/kimi-k3`, `vercel/moonshotai/kimi-k3`). The `opencode/`-prefixed ones
route through your opencode account; the others need that provider's own auth. Switch
with `crew agent set <name> --model opencode/kimi-k3` -- runner stays `opencode`, only
the model line changes.

## Adding your own runner

Anything launchable works. Add a block to `crew.md` -- `{{prompt}}` and `{{model}}`
are filled per session:

```yaml
runners:
  myrunner:
    cmd: myrunner
    args: ["run", "--model", "{{model}}", "{{prompt}}"]
```

Then `runner: myrunner` in the agent, `crew agent lint` to confirm, `crew agent enable`.
Wrangler's spawn-agent form only auto-detects Claude Code and opencode; anything else
goes through `Other (type manually)` plus the `crew.md` snippet above.

## Troubleshooting

* `runner "x" isn't defined in crew.md runners` (lint error): the `runner:` value
  doesn't match any `runners:` key -- check spelling.
* `runner command "y" isn't on PATH` (lint warning, non-blocking): install the CLI or
  fix `cmd`. At session time a missing command emits `agent.error` and the agent never
  wakes -- check `crew events` if an enabled agent stays silent.
* Cost tracking: only runners with `cost_from_json: true` report spend (Claude Code
  does; opencode sessions show no dollar cost in `crew status`).

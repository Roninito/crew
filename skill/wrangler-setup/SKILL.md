---
name: wrangler-setup
description: Install and initialize Wrangler and crew in an Obsidian vault that doesn't have them yet. Use this whenever a human asks to set up crew, install Wrangler, get the crew team running in this vault, or you notice there is no crew/ folder or .obsidian/plugins/wrangler here. This is a bootstrap-only skill: once crew/crew.md exists and the server is healthy, switch to crew/skills/crew-manager/SKILL.md (copied into the vault by this setup) for running the team.
---

# Wrangler setup

You're helping a human get **crew** (the agent team manager) and **Wrangler** (its Obsidian plugin) running in a vault that doesn't have them yet. This is a one-time bootstrap. Don't try to run agents or create tasks here — that's `crew-manager`'s job, once it exists.

crew and Wrangler live at https://github.com/roninito/crew. Wrangler isn't in the Obsidian community plugin directory yet, so it's installed from crew's GitHub releases.

## Steps

1. **Find the vault root.** It's the folder containing `.obsidian/`. If you're not sure, ask the human, or check the working directory and its parents for `.obsidian/`.

2. **Check what's already there.**
   - `crew/crew.md` exists → crew is already set up. Stop here and switch to `crew/skills/crew-manager/SKILL.md`.
   - `.obsidian/plugins/wrangler/manifest.json` exists but `crew/crew.md` doesn't → Wrangler is installed but has never been enabled (or crew hasn't been enabled since). Skip to step 4.
   - Neither exists → continue to step 3.

3. **Install Wrangler.** Run, with the real vault path in place of the placeholder:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/roninito/crew/main/scripts/install-wrangler.sh | bash -s -- "<vault root>"
   ```
   This downloads `main.js`, `manifest.json` and `styles.css` from crew's latest release into `<vault root>/.obsidian/plugins/wrangler/`. It does not touch anything else in the vault, and it does not enable the plugin.

4. **Tell the human to enable it.** This step needs a human in Obsidian's UI — you can't do it from the shell:
   - Open the vault in Obsidian.
   - Settings > Community plugins. If community plugins are off, Obsidian shows a one-time confirmation to turn them on; the human has to accept that.
   - Find **Wrangler** in the installed list and enable it.

   The moment it's enabled, Wrangler creates the `crew/` folder layout, templates, wiki and skill, generates the API token in `crew/crew.md`, downloads the `crew` binary for the human's OS, and starts the server. No other install step exists.

5. **Confirm it worked.** Once the human says they've enabled it (or after giving it a few seconds), check:
   ```bash
   test -f "<vault root>/crew/crew.md" && echo "crew/ is set up"
   ```
   Then read the port and token out of `crew/crew.md`'s frontmatter and check the server:
   ```bash
   curl -s http://127.0.0.1:<port>/health
   ```
   If `crew/crew.md` exists but `/health` doesn't respond, Wrangler is still downloading crew's binary the first time (can take a few seconds) or the vault needs to be reopened — ask the human to check the Wrangler sidebar (ribbon icon) for a Notice explaining what's blocked.

6. **Hand off.** Once `/health` responds, tell the human setup is done and point yourself (and them) at `crew/skills/crew-manager/SKILL.md` for everything else: creating agents, tasks, and running the team.

## If there's no Obsidian at all

crew runs standalone too. Download the binary matching the host directly from `https://github.com/roninito/crew/releases/latest/download/crew-<platform>` (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, or `windows-x64.exe`), `chmod +x` it, then run `crew serve --vault <vault root>`. This starts the server but does not create `crew/` on its own the way Wrangler does — for a headless setup, clone the crew repo and run `scripts/init-vault.sh <vault>` first, or ask the human whether they'd rather install Obsidian and Wrangler instead.

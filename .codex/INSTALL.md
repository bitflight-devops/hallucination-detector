# Installing Hallucination Detector for Codex

Adds a stop-hook that blocks speculation, ungrounded causality, and completeness overclaims — forcing evidence-first responses.

## Prerequisites

- Git
- Node.js (for the stop-hook script)

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/bitflight-devops/hallucination-detector.git ~/.codex/hallucination-detector
   ```

2. **Create the commands symlink:**

   ```bash
   mkdir -p ~/.agents/commands
   ln -s ~/.codex/hallucination-detector/commands ~/.agents/commands/hallucination-detector
   ```

   **Windows (PowerShell):**

   ```powershell
   New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\commands"
   cmd /c mklink /J "$env:USERPROFILE\.agents\commands\hallucination-detector" "$env:USERPROFILE\.codex\hallucination-detector\commands"
   ```

3. **Add the stop-hook to your AGENTS.md:**

   Add this to `~/.codex/AGENTS.md`:

   ````markdown
   ## Hallucination Detector

   Before completing any task, run:

   ```text
   node ~/.codex/hallucination-detector/scripts/hallucination-audit-stop.cjs
   ```

   If the output contains `"decision": "block"`, rewrite your response following the instructions in the `reason` field.
   ````

4. **Restart Codex** (quit and relaunch the CLI).

## Verify

```bash
ls -la ~/.agents/commands/hallucination-detector
```

You should see a symlink pointing to the hallucination-detector commands directory.

## Updating

```bash
cd ~/.codex/hallucination-detector && git pull
```

## Uninstalling

```bash
rm ~/.agents/commands/hallucination-detector
```

Optionally delete the clone: `rm -rf ~/.codex/hallucination-detector`.

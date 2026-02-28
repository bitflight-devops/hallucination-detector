# Installing Hallucination Detector for OpenCode

## Prerequisites

- [OpenCode.ai](https://opencode.ai) installed
- Git installed
- Node.js installed (for the stop-hook script)

## Installation Steps

### 1. Clone Hallucination Detector

```bash
git clone https://github.com/bitflight-devops/hallucination-detector.git ~/.config/opencode/hallucination-detector
```

### 2. Register the Plugin

Create a symlink so OpenCode discovers the plugin:

```bash
mkdir -p ~/.config/opencode/plugins
rm -f ~/.config/opencode/plugins/hallucination-detector.cjs
ln -s ~/.config/opencode/hallucination-detector/.opencode/plugins/hallucination-detector.cjs ~/.config/opencode/plugins/hallucination-detector.cjs
```

### 3. Restart OpenCode

Restart OpenCode. The plugin will automatically inject the hallucination detection stop-hook.

Verify by asking: "do you have hallucination detection?"

## Usage

### Automatic Behavior

The stop-hook runs automatically every time the assistant attempts to complete a task. If speculation, ungrounded causality, pseudo-quantification, or completeness overclaims are detected, the response is blocked and must be rewritten with evidence.

### Manual Audit

Use the audit command to manually check text:

```
use skill tool to load hallucination-detector/hallucination-audit
```

Then paste the content to audit.

### Tool Mapping

When commands reference Claude Code tools:

- `TodoWrite` → `update_plan`
- `Task` with subagents → `@mention` syntax
- `Skill` tool → OpenCode's native `skill` tool
- File operations → your native tools

## Updating

```bash
cd ~/.config/opencode/hallucination-detector
git pull
```

## Troubleshooting

### Plugin not loading

1. Check plugin symlink: `ls -l ~/.config/opencode/plugins/hallucination-detector.cjs`
2. Check source exists: `ls ~/.config/opencode/hallucination-detector/.opencode/plugins/hallucination-detector.cjs`
3. Check OpenCode logs for errors

## Getting Help

- Report issues: https://github.com/bitflight-devops/hallucination-detector/issues

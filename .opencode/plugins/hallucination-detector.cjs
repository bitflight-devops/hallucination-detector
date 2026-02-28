/**
 * Hallucination Detector plugin for OpenCode.ai
 *
 * Injects hallucination detection context via system prompt transform.
 * The stop-hook script runs automatically to audit assistant output.
 */

const path = require('node:path');
const fs = require('node:fs');

const __pluginDir = __dirname;

// Simple frontmatter extraction
const extractAndStripFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content };

  const frontmatterStr = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of frontmatterStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line
        .slice(colonIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content: body };
};

const HallucinationDetectorPlugin = async () => {
  const pluginRoot = path.resolve(__pluginDir, '../..');
  const auditCommandPath = path.join(pluginRoot, 'commands', 'hallucination-audit.md');

  const getBootstrapContent = () => {
    if (!fs.existsSync(auditCommandPath)) return null;

    const fullContent = fs.readFileSync(auditCommandPath, 'utf8');
    const { content } = extractAndStripFrontmatter(fullContent);

    const toolMapping = `**Tool Mapping for OpenCode:**
When commands reference tools you don't have, substitute OpenCode equivalents:
- \`TodoWrite\` → \`update_plan\`
- \`Task\` tool with subagents → Use OpenCode's subagent system (@mention)
- \`Skill\` tool → OpenCode's native \`skill\` tool
- \`Read\`, \`Write\`, \`Edit\`, \`Bash\` → Your native tools`;

    return `<EXTREMELY_IMPORTANT>
You have the hallucination-detector plugin installed.

**IMPORTANT: The hallucination-audit command content is included below. It is ALREADY LOADED — you are currently following it. Do NOT use the skill tool to load "hallucination-audit" again.**

${content}

${toolMapping}
</EXTREMELY_IMPORTANT>`;
  };

  return {
    'experimental.chat.system.transform': async (_input, output) => {
      const bootstrap = getBootstrapContent();
      if (bootstrap) {
        if (!output.system) {
          output.system = [];
        }
        output.system.push(bootstrap);
      }
    },
  };
};

module.exports = { HallucinationDetectorPlugin };

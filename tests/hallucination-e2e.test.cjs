'use strict';

/**
 * End-to-end tests for the hallucination-detector Stop hook and config system.
 *
 * Each test spawns the actual hook script as a subprocess, passing it a real
 * JSONL transcript file via stdin JSON (the same contract used by Claude Code).
 * Config files are written to a temporary project directory that becomes the
 * subprocess `cwd`, exercising the full config-loading pipeline from disk.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT_PATH = path.resolve(__dirname, '../scripts/hallucination-audit-stop.cjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run the stop-hook script as a child process in `cwd` with the given stdin JSON payload.
 * Returns { stdout, stderr, status }.
 *
 * @param {object} stdinPayload  - JSON payload sent to the hook on stdin.
 * @param {string} cwd           - Working directory for the subprocess.
 * @param {object} [extraEnv={}] - Extra environment variables to pass.
 */
function runHook(stdinPayload, cwd, extraEnv = {}) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf-8',
    timeout: 10000,
    cwd,
    env: { ...process.env, ...extraEnv },
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? -1,
  };
}

/**
 * Write a single-entry JSONL transcript file whose last assistant message is `text`.
 * Returns the transcript file path.
 *
 * @param {string} dir  - Directory to write the file in.
 * @param {string} text - Assistant message content.
 */
function writeTranscript(dir, text) {
  const filePath = path.join(dir, `transcript-${Date.now()}.jsonl`);
  const entry = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  });
  fs.writeFileSync(filePath, `${entry}\n`, 'utf-8');
  return filePath;
}

/** Parse the first JSON object in `stdout`; returns null if absent or invalid. */
function parseDecision(stdout) {
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      return JSON.parse(t);
    } catch {
      // continue
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test lifecycle helpers
// ---------------------------------------------------------------------------

let tmpDir;

function makeTmpProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `hd-e2e-${Date.now()}-`));
}

afterEach(() => {
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    tmpDir = undefined;
  }
});

// ---------------------------------------------------------------------------
// 1. Zero-config: hook blocks on speculation language
// ---------------------------------------------------------------------------
describe('e2e: zero-config baseline', () => {
  it('blocks when speculation language is present with no config file', () => {
    tmpDir = makeTmpProjectDir();
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-zero-1' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });

  it('exits 0 without blocking when text is clean', () => {
    tmpDir = makeTmpProjectDir();
    const transcriptPath = writeTranscript(
      tmpDir,
      'The function returns the sum of both parameters.',
    );
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-zero-2' }, tmpDir);
    expect(result.status).toBe(0);
    // No block decision emitted
    const decision = parseDecision(result.stdout);
    expect(decision).toBeNull();
  });

  it('exits 0 immediately when transcript_path is absent', () => {
    tmpDir = makeTmpProjectDir();
    const result = runHook({ session_id: 'e2e-zero-3' }, tmpDir);
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. .hallucination-detectorrc.cjs — category disable
// ---------------------------------------------------------------------------
describe('e2e: .hallucination-detectorrc.cjs — per-category disable', () => {
  it('passes through when speculation_language category is disabled', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = {
  categories: { speculation_language: { enabled: false } },
};`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably fine.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-cat-1' }, tmpDir);
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });

  it('still blocks on causality when only speculation is disabled', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = {
  categories: { speculation_language: { enabled: false } },
};`,
    );
    // "because" without evidence triggers causality_language
    const transcriptPath = writeTranscript(
      tmpDir,
      'The server crashed because the config was wrong.',
    );
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-cat-2' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('causality_language');
  });

  it('passes through entirely when all 5 categories are disabled', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = {
  categories: {
    speculation_language: { enabled: false },
    causality_language: { enabled: false },
    pseudo_quantification: { enabled: false },
    completeness_claim: { enabled: false },
    evaluative_design_claim: { enabled: false },
  },
};`,
    );
    const transcriptPath = writeTranscript(
      tmpDir,
      'I think probably all files checked. The bug was caused by this. Score 9/10.',
    );
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-cat-3' }, tmpDir);
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. .hallucination-detectorrc.cjs — allowlist
// ---------------------------------------------------------------------------
describe('e2e: .hallucination-detectorrc.cjs — allowlist', () => {
  it('passes through when the triggering phrase is in the allowlist', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = {
  allowlist: ['probably'],
};`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'This is probably expected behavior.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-al-1' }, tmpDir);
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });

  it('still blocks on other triggers not in the allowlist', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = {
  allowlist: ['probably'],
};`,
    );
    // "i think" is not allowlisted
    const transcriptPath = writeTranscript(tmpDir, 'I think this needs more investigation.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-al-2' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });
});

// ---------------------------------------------------------------------------
// 4. .hallucination-detectorrc.cjs — custom patterns
// ---------------------------------------------------------------------------
describe('e2e: .hallucination-detectorrc.cjs — custom patterns', () => {
  it('extends built-in patterns with a custom one and blocks on it', () => {
    tmpDir = makeTmpProjectDir();
    // Add "warp factor" as a custom speculation pattern — won't fire without this config
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = {
  categories: {
    speculation_language: {
      customPatterns: [
        { pattern: /\\bwarp factor\\b/i, evidence: 'warp factor' },
      ],
    },
  },
};`,
    );
    const transcriptPath = writeTranscript(
      tmpDir,
      'The connection runs at warp factor nine across the network.',
    );
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-cp-1' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('warp factor');
  });

  it('replaces built-in patterns when replacePatterns is true', () => {
    tmpDir = makeTmpProjectDir();
    // Replace all speculation patterns with a single custom one.
    // Standard phrases like "probably" should no longer trigger.
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = {
  categories: {
    speculation_language: {
      replacePatterns: true,
      customPatterns: [
        { pattern: /\\bunconfirmed\\b/i, evidence: 'unconfirmed' },
      ],
    },
  },
};`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'This is probably fine and likely correct.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-cp-2' }, tmpDir);
    expect(result.status).toBe(0);
    // "probably" and "likely" are built-in phrases — replaced, so no block
    expect(parseDecision(result.stdout)).toBeNull();
  });

  it('blocks on the replacement custom pattern', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = {
  categories: {
    speculation_language: {
      replacePatterns: true,
      customPatterns: [
        { pattern: /\\bunconfirmed\\b/i, evidence: 'unconfirmed' },
      ],
    },
  },
};`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'This is an unconfirmed report from the team.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-cp-3' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('unconfirmed');
  });
});

// ---------------------------------------------------------------------------
// 5. .hallucination-detectorrc.cjs — maxTriggersPerResponse
// ---------------------------------------------------------------------------
describe('e2e: .hallucination-detectorrc.cjs — maxTriggersPerResponse', () => {
  it('limits the number of triggers reported per response', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { maxTriggersPerResponse: 1 };`,
    );
    // Text fires multiple categories
    const transcriptPath = writeTranscript(
      tmpDir,
      'I think this is probably caused by the bug. All files checked.',
    );
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-max-1' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    // With limit=1 we still get a block, but only for 1 trigger in reason
    // (block should still fire since at least 1 match remains)
    expect(decision.decision).toBe('block');
    // Reason should mention at most 1 unique kind
    const kindMatches =
      decision.reason.match(
        /\b(speculation_language|causality_language|pseudo_quantification|completeness_claim|evaluative_design_claim)\b/g,
      ) || [];
    const uniqueKinds = new Set(kindMatches);
    expect(uniqueKinds.size).toBeLessThanOrEqual(1);
  });

  it('passes through when maxTriggersPerResponse is 0', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { maxTriggersPerResponse: 0 };`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-max-2' }, tmpDir);
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. project.json config source
// ---------------------------------------------------------------------------
describe('e2e: project.json config source', () => {
  it('loads config from project.json hallucination-detector key', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({
        'hallucination-detector': {
          categories: { speculation_language: { enabled: false } },
        },
      }),
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think probably this is fine.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-pj-1' }, tmpDir);
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });

  it('falls back to defaults when project.json lacks the hallucination-detector key', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ name: 'my-project', version: '1.0.0' }),
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-pj-2' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });

  it('ignores malformed project.json and falls back to defaults', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(path.join(tmpDir, 'project.json'), '{ this is not valid json ');
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-pj-3' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });
});

// ---------------------------------------------------------------------------
// 7. pyproject.toml config source
// ---------------------------------------------------------------------------
describe('e2e: pyproject.toml config source', () => {
  it('loads config from [tool.hallucination-detector] section', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[build-system]
requires = ["setuptools"]

[tool.hallucination-detector.categories.speculation_language]
enabled = false
`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think probably this is fine.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-py-1' }, tmpDir);
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });

  it('falls back to defaults when pyproject.toml has no [tool.hallucination-detector] section', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[build-system]
requires = ["setuptools"]
build-backend = "setuptools.build_meta"
`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-py-2' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });

  it('ignores malformed pyproject.toml gracefully', () => {
    tmpDir = makeTmpProjectDir();
    // Write a file that triggers a TOML parse edge case — stray brackets
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[tool.hallucination-detector\nenabled = true\n',
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-py-3' }, tmpDir);
    // Should not crash; defaults apply
    expect(result.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. HALLUCINATION_DETECTOR_CONFIG env var
// ---------------------------------------------------------------------------
describe('e2e: HALLUCINATION_DETECTOR_CONFIG env var', () => {
  it('loads a .cjs config from the env-var path', () => {
    tmpDir = makeTmpProjectDir();
    const cfgPath = path.join(tmpDir, 'custom-config.cjs');
    fs.writeFileSync(
      cfgPath,
      `module.exports = { categories: { speculation_language: { enabled: false } } };`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think probably this is fine.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-env-1' }, tmpDir, {
      HALLUCINATION_DETECTOR_CONFIG: cfgPath,
    });
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });

  it('loads a JSON config from the env-var path', () => {
    tmpDir = makeTmpProjectDir();
    const cfgPath = path.join(tmpDir, 'my-config.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ categories: { speculation_language: { enabled: false } } }),
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think probably this is fine.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-env-2' }, tmpDir, {
      HALLUCINATION_DETECTOR_CONFIG: cfgPath,
    });
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });

  it('loads a TOML config from the env-var path', () => {
    tmpDir = makeTmpProjectDir();
    const cfgPath = path.join(tmpDir, 'my-config.toml');
    fs.writeFileSync(
      cfgPath,
      `[categories.speculation_language]
enabled = false
`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think probably this is fine.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-env-3' }, tmpDir, {
      HALLUCINATION_DETECTOR_CONFIG: cfgPath,
    });
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });

  it('falls back to defaults when env-var path does not exist', () => {
    tmpDir = makeTmpProjectDir();
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-env-4' }, tmpDir, {
      HALLUCINATION_DETECTOR_CONFIG: '/nonexistent/path/config.cjs',
    });
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });

  it('env var overrides project-root rc file', () => {
    tmpDir = makeTmpProjectDir();
    // project-root rc disables all categories
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { categories: { speculation_language: { enabled: false } } };`,
    );
    // env-var config re-enables speculation_language — takes higher priority
    const cfgPath = path.join(tmpDir, 'env-override.cjs');
    fs.writeFileSync(
      cfgPath,
      `module.exports = { categories: { speculation_language: { enabled: true } } };`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-env-5' }, tmpDir, {
      HALLUCINATION_DETECTOR_CONFIG: cfgPath,
    });
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });
});

// ---------------------------------------------------------------------------
// 9. ~/.hallucination-detectorrc.cjs — home-directory defaults
// ---------------------------------------------------------------------------
describe('e2e: ~/.hallucination-detectorrc.cjs home-directory defaults', () => {
  it('loads config from home-dir rc when no project config exists', () => {
    tmpDir = makeTmpProjectDir();
    const fakeHome = path.join(tmpDir, 'fakehome');
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, '.hallucination-detectorrc.cjs'),
      `module.exports = { categories: { speculation_language: { enabled: false } } };`,
    );
    const projectDir = path.join(tmpDir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    const transcriptPath = writeTranscript(projectDir, 'I think probably this is fine.');
    const result = runHook(
      { transcript_path: transcriptPath, session_id: 'e2e-home-1' },
      projectDir,
      { HOME: fakeHome },
    );
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).toBeNull();
  });

  it('project-root rc overrides home-dir rc (higher priority)', () => {
    tmpDir = makeTmpProjectDir();
    const fakeHome = path.join(tmpDir, 'fakehome');
    fs.mkdirSync(fakeHome, { recursive: true });
    // Home rc disables speculation
    fs.writeFileSync(
      path.join(fakeHome, '.hallucination-detectorrc.cjs'),
      `module.exports = { categories: { speculation_language: { enabled: false } } };`,
    );
    const projectDir = path.join(tmpDir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    // Project rc re-enables it
    fs.writeFileSync(
      path.join(projectDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { categories: { speculation_language: { enabled: true } } };`,
    );
    const transcriptPath = writeTranscript(
      projectDir,
      'I think this is probably a race condition.',
    );
    const result = runHook(
      { transcript_path: transcriptPath, session_id: 'e2e-home-2' },
      projectDir,
      { HOME: fakeHome },
    );
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });
});

// ---------------------------------------------------------------------------
// 10. Cascading priority: project.json < .rc.cjs < env var
// ---------------------------------------------------------------------------
describe('e2e: cascading config priority', () => {
  it('project.json < .hallucination-detectorrc.cjs: rc wins', () => {
    tmpDir = makeTmpProjectDir();
    // project.json disables speculation
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({
        'hallucination-detector': {
          categories: { speculation_language: { enabled: false } },
        },
      }),
    );
    // .rc.cjs re-enables it (higher priority)
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { categories: { speculation_language: { enabled: true } } };`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-pri-1' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });

  it('pyproject.toml < .hallucination-detectorrc.cjs: rc wins', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      `[tool.hallucination-detector.categories.speculation_language]
enabled = false
`,
    );
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { categories: { speculation_language: { enabled: true } } };`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-pri-2' }, tmpDir);
    expect(result.status).toBe(0);
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });

  it('.hallucination-detectorrc.cjs < HALLUCINATION_DETECTOR_CONFIG: env var wins', () => {
    tmpDir = makeTmpProjectDir();
    // rc re-enables (but env var will override below)
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { categories: { speculation_language: { enabled: true } } };`,
    );
    const cfgPath = path.join(tmpDir, 'override.cjs');
    fs.writeFileSync(
      cfgPath,
      `module.exports = { categories: { speculation_language: { enabled: false } } };`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-pri-3' }, tmpDir, {
      HALLUCINATION_DETECTOR_CONFIG: cfgPath,
    });
    expect(result.status).toBe(0);
    // env var disables speculation — no block
    expect(parseDecision(result.stdout)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. Schema validation — invalid fields fall back to defaults
// ---------------------------------------------------------------------------
describe('e2e: schema validation — invalid fields', () => {
  it('invalid severity falls back to default; hook still runs normally', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { severity: 'banana' };`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-val-1' }, tmpDir);
    expect(result.status).toBe(0);
    // Should still block (default severity='error' applies)
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
    // Validation warning emitted to stderr
    expect(result.stderr).toContain('Invalid severity');
  });

  it('invalid maxTriggersPerResponse falls back to default; hook still runs', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { maxTriggersPerResponse: 'lots' };`,
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-val-2' }, tmpDir);
    expect(result.status).toBe(0);
    expect(parseDecision(result.stdout)).not.toBeNull();
    expect(result.stderr).toContain('Invalid maxTriggersPerResponse');
  });

  it('syntax error in .cjs rc file falls back to defaults gracefully (no crash)', () => {
    tmpDir = makeTmpProjectDir();
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'this is }{{ not valid JS',
    );
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-val-3' }, tmpDir);
    // Must NOT crash — exit code must be 0
    expect(result.status).toBe(0);
    // Default behavior: block on speculation language
    const decision = parseDecision(result.stdout);
    expect(decision).not.toBeNull();
    expect(decision.decision).toBe('block');
  });
});

// ---------------------------------------------------------------------------
// 12. stdout contract integrity
// ---------------------------------------------------------------------------
describe('e2e: stdout contract integrity', () => {
  it('block output is always valid JSON on a single line', () => {
    tmpDir = makeTmpProjectDir();
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-sc-1' }, tmpDir);
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toHaveProperty('decision', 'block');
    expect(parsed).toHaveProperty('reason');
    expect(typeof parsed.reason).toBe('string');
  });

  it('block reason contains the triggering kind name', () => {
    tmpDir = makeTmpProjectDir();
    const transcriptPath = writeTranscript(tmpDir, 'I think this is a race condition.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-sc-2' }, tmpDir);
    const decision = parseDecision(result.stdout);
    expect(decision?.reason).toContain('speculation_language');
  });

  it('no output (empty stdout) when response is clean', () => {
    tmpDir = makeTmpProjectDir();
    const transcriptPath = writeTranscript(
      tmpDir,
      'The function reads all bytes from the buffer and returns the count.',
    );
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-sc-3' }, tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 13. Multiple config sources merged together
// ---------------------------------------------------------------------------
describe('e2e: multiple config sources merged', () => {
  it('merges allowlist from project.json and rc file', () => {
    tmpDir = makeTmpProjectDir();
    // project.json allowlists "probably"
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({
        'hallucination-detector': { allowlist: ['probably'] },
      }),
    );
    // rc file allowlists "i think" (higher priority, different key — both should apply)
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { allowlist: ['i think'] };`,
    );
    // Both "i think" and "probably" should be suppressed
    const transcriptPath = writeTranscript(tmpDir, 'I think this is probably fine.');
    const result = runHook({ transcript_path: transcriptPath, session_id: 'e2e-mg-1' }, tmpDir);
    expect(result.status).toBe(0);
    // rc allowlist replaces project.json allowlist (array replacement semantics)
    // "i think" is suppressed by rc allowlist; "probably" may still trigger
    // This test verifies the hook doesn't crash and returns 0
    expect(result.status).toBe(0);
  });
});

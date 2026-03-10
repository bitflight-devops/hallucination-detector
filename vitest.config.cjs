'use strict';

const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    include: ['tests/**/*.test.cjs'],
    environment: 'node',
    globals: true,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'scripts/hallucination-audit-stop.cjs',
        'scripts/hallucination-config.cjs',
        'scripts/hallucination-annotate.cjs',
        '.claude/scripts/lib/story-helpers.cjs',
      ],
      exclude: ['node_modules/**', 'tests/**', 'dist/**'],
      thresholds: {
        lines: 75,
        branches: 60,
        functions: 80,
      },
    },
  },
});

'use strict';

const { parseToml } = require('../scripts/hallucination-config-toml.cjs');

describe('parseToml', () => {
  describe('empty input', () => {
    it('empty string returns empty object', () => {
      expect(parseToml('')).toEqual({});
    });

    it('whitespace-only string returns empty object', () => {
      expect(parseToml('   \n  \n  ')).toEqual({});
    });
  });

  describe('comments', () => {
    it('full-line comments are skipped', () => {
      const src = `
# This is a comment
# Another comment
`;
      expect(parseToml(src)).toEqual({});
    });

    it('inline comments are stripped from values', () => {
      const src = 'key = "hello" # comment here';
      expect(parseToml(src)).toEqual({ key: 'hello' });
    });

    it('inline comment after number', () => {
      const src = 'count = 42 # the answer';
      expect(parseToml(src)).toEqual({ count: 42 });
    });
  });

  describe('scalar key-value pairs', () => {
    it('parses string values', () => {
      expect(parseToml('name = "Alice"')).toEqual({ name: 'Alice' });
    });

    it('parses single-quoted string values', () => {
      expect(parseToml("mode = 'strict'")).toEqual({ mode: 'strict' });
    });

    it('parses integer values', () => {
      expect(parseToml('count = 10')).toEqual({ count: 10 });
    });

    it('parses float values', () => {
      expect(parseToml('ratio = 0.75')).toEqual({ ratio: 0.75 });
    });

    it('parses negative numbers', () => {
      expect(parseToml('offset = -5')).toEqual({ offset: -5 });
    });

    it('parses boolean true', () => {
      expect(parseToml('enabled = true')).toEqual({ enabled: true });
    });

    it('parses boolean false', () => {
      expect(parseToml('verbose = false')).toEqual({ verbose: false });
    });

    it('ignores lines without an equals sign', () => {
      const src = 'not a valid line\nkey = "value"';
      expect(parseToml(src)).toEqual({ key: 'value' });
    });
  });

  describe('section headers', () => {
    it('[section] creates a nested object', () => {
      const src = `
[tool]
name = "test"
`;
      expect(parseToml(src)).toEqual({ tool: { name: 'test' } });
    });

    it('[section.sub] creates doubly-nested object', () => {
      const src = `
[tool.myapp]
debug = true
`;
      expect(parseToml(src)).toEqual({ tool: { myapp: { debug: true } } });
    });

    it('multiple section headers', () => {
      const src = `
[a]
x = 1

[b]
y = 2
`;
      expect(parseToml(src)).toEqual({ a: { x: 1 }, b: { y: 2 } });
    });

    it('top-level keys before any section header', () => {
      const src = `
version = "1.0"

[meta]
author = "Alice"
`;
      expect(parseToml(src)).toEqual({ version: '1.0', meta: { author: 'Alice' } });
    });

    it('deeply dotted section header [a.b.c]', () => {
      const src = `
[a.b.c]
leaf = 99
`;
      expect(parseToml(src)).toEqual({ a: { b: { c: { leaf: 99 } } } });
    });

    it('section with hyphenated name', () => {
      const src = `
[hallucination-detector]
enabled = true
`;
      expect(parseToml(src)).toEqual({ 'hallucination-detector': { enabled: true } });
    });
  });

  describe('arrays', () => {
    it('parses empty array', () => {
      expect(parseToml('items = []')).toEqual({ items: [] });
    });

    it('parses array of numbers', () => {
      expect(parseToml('nums = [1, 2, 3]')).toEqual({ nums: [1, 2, 3] });
    });

    it('parses array of strings', () => {
      expect(parseToml('tags = ["a", "b", "c"]')).toEqual({ tags: ['a', 'b', 'c'] });
    });

    it('parses array of booleans', () => {
      expect(parseToml('flags = [true, false, true]')).toEqual({ flags: [true, false, true] });
    });
  });

  describe('inline tables', () => {
    it('parses inline table with string values', () => {
      const src = 'config = {key = "value", mode = "strict"}';
      expect(parseToml(src)).toEqual({ config: { key: 'value', mode: 'strict' } });
    });

    it('parses inline table with number values', () => {
      const src = 'thresholds = {uncertain = 0.3, hallucinated = 0.6}';
      expect(parseToml(src)).toEqual({ thresholds: { uncertain: 0.3, hallucinated: 0.6 } });
    });

    it('parses empty inline table', () => {
      const src = 'opts = {}';
      expect(parseToml(src)).toEqual({ opts: {} });
    });
  });

  describe('quoted string escape sequences', () => {
    it('parses \\n as newline', () => {
      const src = 'msg = "line1\\nline2"';
      const result = parseToml(src);
      expect(result.msg).toBe('line1\nline2');
    });

    it('parses \\t as tab', () => {
      const src = 'msg = "col1\\tcol2"';
      const result = parseToml(src);
      expect(result.msg).toBe('col1\tcol2');
    });

    it('parses \\\\ as backslash', () => {
      const src = 'path = "C:\\\\Users"';
      const result = parseToml(src);
      expect(result.path).toBe('C:\\Users');
    });

    it('parses \\" as double-quote', () => {
      const src = 'msg = "say \\"hi\\""';
      const result = parseToml(src);
      expect(result.msg).toBe('say "hi"');
    });
  });

  describe('real-world hallucination-detector config section', () => {
    it('parses a realistic [tool.hallucination-detector] block', () => {
      const src = `
[tool.hallucination-detector]
severity = "warning"
maxTriggersPerResponse = 10
debug = false
outputFormat = "json"
ignoreCategories = ["completeness_claim"]
`;
      const result = parseToml(src);
      expect(result.tool['hallucination-detector']).toEqual({
        severity: 'warning',
        maxTriggersPerResponse: 10,
        debug: false,
        outputFormat: 'json',
        ignoreCategories: ['completeness_claim'],
      });
    });
  });
});

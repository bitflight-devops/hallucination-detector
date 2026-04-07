#!/usr/bin/env node
/**
 * Minimal TOML parser for hallucination-detector hooks.
 * Handles the subset needed for pyproject.toml sections.
 * Supports: simple key-value pairs (string, number, boolean), section headers
 * ([section] / [section.sub]), and single-line arrays of strings or inline tables.
 * Zero dependencies — Node.js built-ins only.
 */

'use strict';

/**
 * Split `content` on `sep` at depth 0, respecting nested brackets and quoted strings.
 * @param {string} content
 * @param {string} sep - Single separator character.
 * @returns {string[]}
 */
function splitTopLevel(content, sep) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let strChar = '';
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inStr) {
      if (ch === '\\' && i + 1 < content.length) {
        i++;
        continue;
      }
      if (ch === strChar) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
    } else if (ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ']' || ch === '}') {
      depth--;
    } else if (ch === sep && depth === 0) {
      parts.push(content.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(content.slice(start));
  return parts;
}

/**
 * Strip a `#` inline comment from a TOML value string, respecting quoted strings.
 * @param {string} valStr
 * @returns {string}
 */
function stripTomlInlineComment(valStr) {
  let inStr = false;
  let strChar = '';
  for (let i = 0; i < valStr.length; i++) {
    const ch = valStr[i];
    if (inStr) {
      if (ch === '\\' && i + 1 < valStr.length) {
        i++;
        continue;
      }
      if (ch === strChar) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
    } else if (ch === '#') {
      return valStr.slice(0, i).trim();
    }
  }
  return valStr.trim();
}

/**
 * Parse a single TOML value string into a JS value.
 * @param {string} valStr
 * @returns {*}
 */
function parseTomlValue(valStr) {
  const s = stripTomlInlineComment(valStr);
  if (!s) return null;
  // Quoted string
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"');
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // Array
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner, ',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
      .map((item) => parseTomlValue(item));
  }
  // Inline table
  if (s.startsWith('{') && s.endsWith('}')) {
    return parseTomlInlineTable(s.slice(1, -1));
  }
  return s;
}

/**
 * Parse a TOML inline table body (content between `{` and `}`).
 * @param {string} content
 * @returns {object}
 */
function parseTomlInlineTable(content) {
  const table = {};
  if (!content.trim()) return table;
  for (const pair of splitTopLevel(content.trim(), ',')) {
    const p = pair.trim();
    const eqIdx = p.indexOf('=');
    if (eqIdx === -1) continue;
    const k = p.slice(0, eqIdx).trim();
    const v = p.slice(eqIdx + 1).trim();
    if (k) table[k] = parseTomlValue(v);
  }
  return table;
}

/**
 * Parse a TOML source string into a plain JS object.
 * Only handles the subset needed for `[tool.hallucination-detector]` sections.
 *
 * @param {string} source - TOML source text.
 * @returns {object}
 */
function parseToml(source) {
  const result = {};
  let current = result;

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Section header: [key] or [key.subkey]  (not array tables [[...]])
    if (line.startsWith('[') && !line.startsWith('[[')) {
      const end = line.indexOf(']');
      if (end === -1) continue;
      const sectionStr = line.slice(1, end).trim();
      // Split on '.' to get nested path (bare keys may contain hyphens)
      const parts = sectionStr.split('.').map((p) => p.trim());
      current = result;
      for (const part of parts) {
        if (typeof current[part] !== 'object' || current[part] === null) {
          current[part] = {};
        }
        current = current[part];
      }
      continue;
    }

    // Key-value pair
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const valStr = line.slice(eqIdx + 1).trim();
    if (!key) continue;
    current[key] = parseTomlValue(valStr);
  }

  return result;
}

module.exports = { parseToml };

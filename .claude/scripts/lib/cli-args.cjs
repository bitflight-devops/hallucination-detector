'use strict';

/**
 * Create arg-parsing functions bound to a specific argv array.
 * @param {string[]} argv - Typically process.argv.slice(2)
 */
function createArgParser(argv) {
  function getArg(name) {
    const idx = argv.indexOf(name);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : null;
  }

  function getArgAll(name) {
    const values = [];
    for (let i = 0; i < argv.length - 1; i++) {
      if (argv[i] === name) {
        values.push(argv[i + 1]);
      }
    }
    return values;
  }

  return { getArg, getArgAll, args: argv };
}

/**
 * Parse a string as an integer, exiting with an error if invalid.
 * @param {string} str - The string to parse.
 * @param {string} label - Human-readable label for error messages (e.g. "PR number", "review ID").
 * @returns {number}
 */
function parseIntArg(str, label) {
  const n = Number.parseInt(str, 10);
  if (Number.isNaN(n)) {
    console.error(`ERROR: invalid ${label} '${str}'`);
    process.exit(1);
  }
  return n;
}

/**
 * Get a required named argument, exiting with an error if missing.
 * @param {function} getArgFn - The getArg function from createArgParser.
 * @param {string} name - The flag name (e.g. '--title').
 * @param {string} [description] - Human-readable description for the error message.
 * @returns {string}
 */
function requireArg(getArgFn, name, description) {
  const value = getArgFn(name);
  if (!value) {
    console.error(`ERROR: ${description || name} is required`);
    process.exit(1);
  }
  return value;
}

module.exports = { createArgParser, parseIntArg, requireArg };

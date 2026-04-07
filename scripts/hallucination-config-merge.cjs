#!/usr/bin/env node
/**
 * Deep freeze and deep merge utilities for hallucination-detector config objects.
 * Zero dependencies — Node.js built-ins only.
 */

'use strict';

/**
 * Recursively freeze an object and all nested plain objects / arrays.
 * @param {*} obj
 * @returns {*} The frozen value.
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  for (const val of Object.values(obj)) {
    deepFreeze(val);
  }
  return Object.freeze(obj);
}

/**
 * Deep-merge two config objects.  Rules:
 * - Plain objects are merged recursively.
 * - `categories.<name>.customPatterns` arrays are concatenated unless the override
 *   has `replacePatterns: true` for that category.
 * - All other arrays are replaced by the override value.
 * - Scalar values are replaced by the override value.
 *
 * Neither argument is mutated; a new object is returned.
 *
 * @param {object} base     - Lower-priority config.
 * @param {object} override - Higher-priority config (wins on conflict).
 * @returns {object} Merged config.
 */
function mergeConfig(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  if (!base || typeof base !== 'object' || Array.isArray(base)) return override;

  const result = { ...base };

  for (const key of Object.keys(override)) {
    const overVal = override[key];
    const baseVal = base[key];

    if (key === 'categories') {
      // Merge categories map, with special customPatterns concatenation logic.
      const baseCats =
        typeof baseVal === 'object' && baseVal !== null && !Array.isArray(baseVal) ? baseVal : {};
      const overCats =
        typeof overVal === 'object' && overVal !== null && !Array.isArray(overVal) ? overVal : {};
      const merged = { ...baseCats };
      for (const catName of Object.keys(overCats)) {
        const baseCat = baseCats[catName] || {};
        const overCat = overCats[catName];
        if (typeof overCat !== 'object' || overCat === null) {
          merged[catName] = overCat;
          continue;
        }
        const mergedCat = { ...baseCat, ...overCat };
        // Concatenate customPatterns unless replacePatterns is true in the override.
        if (
          !overCat.replacePatterns &&
          Array.isArray(baseCat.customPatterns) &&
          Array.isArray(overCat.customPatterns)
        ) {
          mergedCat.customPatterns = [...baseCat.customPatterns, ...overCat.customPatterns];
        }
        merged[catName] = mergedCat;
      }
      result[key] = merged;
    } else if (
      typeof overVal === 'object' &&
      overVal !== null &&
      !Array.isArray(overVal) &&
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      // Both are plain objects — recurse.
      result[key] = mergeConfig(baseVal, overVal);
    } else {
      // Scalar, array, or null — override wins.
      result[key] = overVal;
    }
  }

  return result;
}

module.exports = { mergeConfig, deepFreeze };

'use strict';

const { mergeConfig, deepFreeze } = require('../scripts/hallucination-config-merge.cjs');

describe('mergeConfig', () => {
  describe('basic scalar merging', () => {
    it('returns base when override is null', () => {
      const base = { a: 1 };
      expect(mergeConfig(base, null)).toBe(base);
    });

    it('returns base when override is undefined', () => {
      const base = { a: 1 };
      expect(mergeConfig(base, undefined)).toBe(base);
    });

    it('returns override when base is null', () => {
      const override = { a: 1 };
      expect(mergeConfig(null, override)).toBe(override);
    });

    it('returns override when base is an array', () => {
      const override = { a: 1 };
      expect(mergeConfig([1, 2], override)).toBe(override);
    });

    it('returns base when override is an array', () => {
      const base = { a: 1 };
      expect(mergeConfig(base, [1, 2])).toBe(base);
    });

    it('override scalar wins over base scalar', () => {
      const result = mergeConfig({ x: 1 }, { x: 2 });
      expect(result.x).toBe(2);
    });

    it('base scalar is kept when not in override', () => {
      const result = mergeConfig({ x: 1, y: 2 }, { x: 99 });
      expect(result.y).toBe(2);
    });

    it('does not mutate base', () => {
      const base = { x: 1 };
      mergeConfig(base, { x: 2 });
      expect(base.x).toBe(1);
    });

    it('does not mutate override', () => {
      const override = { x: 2 };
      mergeConfig({ x: 1 }, override);
      expect(override.x).toBe(2);
    });
  });

  describe('nested object merging', () => {
    it('recursively merges nested plain objects', () => {
      const base = { a: { x: 1, y: 2 } };
      const override = { a: { y: 99, z: 3 } };
      const result = mergeConfig(base, override);
      expect(result.a).toEqual({ x: 1, y: 99, z: 3 });
    });

    it('override array replaces base array', () => {
      const base = { items: [1, 2] };
      const override = { items: [3, 4, 5] };
      const result = mergeConfig(base, override);
      expect(result.items).toEqual([3, 4, 5]);
    });

    it('override null replaces base object', () => {
      const base = { meta: { a: 1 } };
      const override = { meta: null };
      const result = mergeConfig(base, override);
      expect(result.meta).toBeNull();
    });
  });

  describe('categories merging', () => {
    it('categories from override are added to base', () => {
      const base = { categories: {} };
      const override = { categories: { speculation_language: { enabled: false } } };
      const result = mergeConfig(base, override);
      expect(result.categories.speculation_language).toEqual({ enabled: false });
    });

    it('customPatterns are concatenated by default', () => {
      const base = {
        categories: {
          speculation_language: { customPatterns: ['pat1'] },
        },
      };
      const override = {
        categories: {
          speculation_language: { customPatterns: ['pat2'] },
        },
      };
      const result = mergeConfig(base, override);
      expect(result.categories.speculation_language.customPatterns).toEqual(['pat1', 'pat2']);
    });

    it('customPatterns are replaced when replacePatterns is true', () => {
      const base = {
        categories: {
          speculation_language: { customPatterns: ['pat1', 'pat2'] },
        },
      };
      const override = {
        categories: {
          speculation_language: { customPatterns: ['new'], replacePatterns: true },
        },
      };
      const result = mergeConfig(base, override);
      expect(result.categories.speculation_language.customPatterns).toEqual(['new']);
    });

    it('category scalar fields are overridden', () => {
      const base = {
        categories: {
          speculation_language: { enabled: true, weight: 0.5 },
        },
      };
      const override = {
        categories: {
          speculation_language: { weight: 0.8 },
        },
      };
      const result = mergeConfig(base, override);
      expect(result.categories.speculation_language.weight).toBe(0.8);
      expect(result.categories.speculation_language.enabled).toBe(true);
    });

    it('preserves base categories not in override', () => {
      const base = {
        categories: {
          cat_a: { enabled: true },
          cat_b: { enabled: false },
        },
      };
      const override = {
        categories: {
          cat_a: { enabled: false },
        },
      };
      const result = mergeConfig(base, override);
      expect(result.categories.cat_b).toEqual({ enabled: false });
    });

    it('non-object category override replaces base category', () => {
      const base = {
        categories: {
          cat_a: { enabled: true },
        },
      };
      const override = {
        categories: {
          cat_a: null,
        },
      };
      const result = mergeConfig(base, override);
      expect(result.categories.cat_a).toBeNull();
    });
  });
});

describe('deepFreeze', () => {
  it('freezes a flat object', () => {
    const obj = { a: 1, b: 2 };
    const frozen = deepFreeze(obj);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('returns the same reference', () => {
    const obj = { a: 1 };
    expect(deepFreeze(obj)).toBe(obj);
  });

  it('freezes nested objects', () => {
    const obj = { a: { b: { c: 3 } } };
    deepFreeze(obj);
    expect(Object.isFrozen(obj.a)).toBe(true);
    expect(Object.isFrozen(obj.a.b)).toBe(true);
  });

  it('freezes nested arrays', () => {
    const obj = { items: [1, 2, 3] };
    deepFreeze(obj);
    expect(Object.isFrozen(obj.items)).toBe(true);
  });

  it('handles null without throwing', () => {
    expect(() => deepFreeze(null)).not.toThrow();
    expect(deepFreeze(null)).toBeNull();
  });

  it('handles primitive values without throwing', () => {
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze('hello')).toBe('hello');
    expect(deepFreeze(true)).toBe(true);
  });

  it('prevents property assignment after freezing (strict mode)', () => {
    const obj = deepFreeze({ x: 1 });
    expect(() => {
      obj.x = 99;
    }).toThrow();
  });

  it('prevents nested property assignment after freezing (strict mode)', () => {
    const obj = deepFreeze({ nested: { y: 2 } });
    expect(() => {
      obj.nested.y = 99;
    }).toThrow();
  });
});

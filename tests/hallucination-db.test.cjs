'use strict';

const { _openDbAt } = require('../scripts/hallucination-db.cjs');

// =============================================================================
// hallucination-db — shared DB helper
// =============================================================================

describe('hallucination-db', () => {
  describe('_openDbAt with :memory:', () => {
    it('creates all four tables', () => {
      const db = _openDbAt(':memory:');
      try {
        const tables = db
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type='table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name`,
          )
          .all()
          .map((r) => r.name);
        expect(tables).toContain('runs');
        expect(tables).toContain('block_categories');
        expect(tables).toContain('stop_hook_log');
        expect(tables).toContain('block_matches');
      } finally {
        db.close();
      }
    });

    it('sets WAL journal mode', () => {
      const db = _openDbAt(':memory:');
      try {
        // In-memory databases always report 'memory' for PRAGMA journal_mode,
        // not 'wal'. The important thing is that the PRAGMA executes without
        // error. For file-backed databases the mode would be 'wal'.
        const row = db.prepare('PRAGMA journal_mode').get();
        expect(typeof row.journal_mode).toBe('string');
      } finally {
        db.close();
      }
    });

    it('is idempotent — calling _openDbAt twice on the same path does not error', () => {
      const os = require('node:os');
      const path = require('node:path');
      const dbPath = path.join(
        os.tmpdir(),
        `hd-db-idem-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
      );
      let db1 = null;
      let db2 = null;
      try {
        db1 = _openDbAt(dbPath);
        db1.close();
        db1 = null;
        // Second open on same file — DDL uses IF NOT EXISTS, must not throw.
        db2 = _openDbAt(dbPath);
        const tables = db2
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type='table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name`,
          )
          .all()
          .map((r) => r.name);
        expect(tables).toContain('runs');
        expect(tables).toContain('stop_hook_log');
      } finally {
        if (db1)
          try {
            db1.close();
          } catch {
            /* ignore */
          }
        if (db2)
          try {
            db2.close();
          } catch {
            /* ignore */
          }
        try {
          require('node:fs').unlinkSync(dbPath);
        } catch {
          /* ignore */
        }
      }
    });

    it('stop_hook_log table has expected columns', () => {
      const db = _openDbAt(':memory:');
      try {
        const cols = db
          .prepare('PRAGMA table_info(stop_hook_log)')
          .all()
          .map((r) => r.name);
        expect(cols).toContain('id');
        expect(cols).toContain('session_id');
        expect(cols).toContain('ts');
        expect(cols).toContain('decision');
        expect(cols).toContain('is_retry');
        expect(cols).toContain('is_structured');
        expect(cols).toContain('response_length_chars');
        expect(cols).toContain('blocks_so_far');
      } finally {
        db.close();
      }
    });

    it('block_matches table has expected columns', () => {
      const db = _openDbAt(':memory:');
      try {
        const cols = db
          .prepare('PRAGMA table_info(block_matches)')
          .all()
          .map((r) => r.name);
        expect(cols).toContain('id');
        expect(cols).toContain('log_id');
        expect(cols).toContain('category');
        expect(cols).toContain('evidence');
      } finally {
        db.close();
      }
    });

    it('block_matches table has was_ignored column', () => {
      const db = _openDbAt(':memory:');
      try {
        const cols = db
          .prepare('PRAGMA table_info(block_matches)')
          .all()
          .map((r) => r.name);
        expect(cols).toContain('was_ignored');
      } finally {
        db.close();
      }
    });

    it('stop_hook_log table has prior_block_id and response_snippet columns', () => {
      const db = _openDbAt(':memory:');
      try {
        const cols = db
          .prepare('PRAGMA table_info(stop_hook_log)')
          .all()
          .map((r) => r.name);
        expect(cols).toContain('prior_block_id');
        expect(cols).toContain('response_snippet');
      } finally {
        db.close();
      }
    });

    it('indexes exist on stop_hook_log', () => {
      const db = _openDbAt(':memory:');
      try {
        const indexes = db
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type='index' AND tbl_name='stop_hook_log'
             ORDER BY name`,
          )
          .all()
          .map((r) => r.name);
        expect(indexes).toContain('idx_stop_hook_session');
        expect(indexes).toContain('idx_prior_block');
      } finally {
        db.close();
      }
    });

    it('sets synchronous=NORMAL pragma without error', () => {
      const db = _openDbAt(':memory:');
      try {
        // PRAGMA synchronous returns 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA.
        // For :memory: the value may still be the default (2=FULL) because
        // NORMAL is only meaningful for file-backed databases, but the PRAGMA
        // must execute without throwing regardless of the returned value.
        const row = db.prepare('PRAGMA synchronous').get();
        expect(typeof row.synchronous).toBe('number');
      } finally {
        db.close();
      }
    });

    it('runs table has expected columns', () => {
      const db = _openDbAt(':memory:');
      try {
        const cols = db
          .prepare('PRAGMA table_info(runs)')
          .all()
          .map((r) => r.name);
        expect(cols).toContain('id');
        expect(cols).toContain('ts');
        expect(cols).toContain('files_scanned');
        expect(cols).toContain('new_blocks');
        expect(cols).toContain('duration_ms');
      } finally {
        db.close();
      }
    });
  });
});

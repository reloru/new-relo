// A D1 database for tests: Node's built-in SQLite behind the subset of the D1
// client API the Worker uses, with the repo's real migrations applied. Tests
// therefore run the same SQL production runs, schema included, and a migration
// that does not parse fails here before it reaches the deploy.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

// Loaded through require so the experimental-feature warning can be silenced
// for this one module without touching the process's other warnings.
const require = createRequire(import.meta.url);
const emit = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes("SQLite") ? undefined : emit.call(process, w, ...rest));
const { DatabaseSync } = require("node:sqlite");
process.emitWarning = emit;

const MIGRATIONS = new URL("../../migrations/", import.meta.url).pathname;

export function d1Stub() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  const plain = (row) => (row ? { ...row } : row);
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    async run() {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    async all() {
      return { success: true, results: db.prepare(sql).all(...args).map(plain) };
    },
    async first(col) {
      const row = plain(db.prepare(sql).get(...args));
      return row == null ? null : col ? row[col] : row;
    },
    _exec: () => {
      const st = db.prepare(sql);
      // A statement that returns rows is read with all(); anything else is run.
      if (/^\s*(select|with)\b/i.test(sql)) return { success: true, results: st.all(...args).map(plain) };
      const r = st.run(...args);
      return { success: true, results: [], meta: { changes: Number(r.changes) } };
    },
  });
  return {
    raw: db,
    prepare: (sql) => statement(sql),
    // D1 runs a batch as one transaction: all of it or none of it.
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s._exec());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 1 };
    },
  };
}

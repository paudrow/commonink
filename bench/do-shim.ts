// Just enough of a Durable Object's storage (ctx.storage.sql and transactionSync) over node:sqlite,
// so the benchmark can run the core the way a workspace Durable Object does: DoDb for queries and
// SqlContent for notes kept in a table. Timings are node:sqlite's, not workerd's, but every query
// the cloud path makes is made here too.
import { DatabaseSync, type StatementSync } from "node:sqlite";

class Cursor<T> {
  constructor(private rows: T[]) {}
  toArray() {
    return this.rows;
  }
  one() {
    if (this.rows.length !== 1) throw new Error(`Expected exactly one row, got ${this.rows.length}`);
    return this.rows[0];
  }
}

export function doStorage(file: string): DurableObjectStorage {
  const db = new DatabaseSync(file);
  const stmts = new Map<string, StatementSync>();
  let depth = 0;
  const storage = {
    sql: {
      exec(sql: string, ...params: any[]) {
        let s = stmts.get(sql);
        if (!s) stmts.set(sql, (s = db.prepare(sql)));
        if (s.columns().length) return new Cursor(s.all(...params));
        s.run(...params);
        return new Cursor([]);
      },
    },
    // Nested calls are savepoints, as in a Durable Object.
    transactionSync<T>(fn: () => T): T {
      const name = `sp${depth++}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const out = fn();
        db.exec(`RELEASE ${name}`);
        return out;
      } catch (e) {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
  return storage as unknown as DurableObjectStorage;
}

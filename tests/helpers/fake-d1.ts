/**
 * Adapter D1 chạy trên SQLite thật (node:sqlite) và áp dụng đúng các file migrations.
 * Nhờ vậy test kiểm tra được SQL thật, gồm UNIQUE, ON CONFLICT, RETURNING và khóa ngoại.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

class FakeStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): FakeStatement {
    // D1 nhận ArrayBuffer cho cột BLOB, node:sqlite cần Uint8Array.
    const params = values.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v));
    return new FakeStatement(this.db, this.sql, params as SQLInputValue[]);
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).all(...this.params)[0] as T) ?? null;
  }

  async all<T>() {
    return this.execAll<T>();
  }

  async run() {
    return this.execAll();
  }

  execAll<T>() {
    const stmt = this.db.prepare(this.sql);
    if (/\bRETURNING\b/i.test(this.sql) || /^\s*SELECT/i.test(this.sql)) {
      const results = stmt.all(...this.params) as T[];
      return { results, success: true, meta: { changes: results.length } };
    }
    const info = stmt.run(...this.params);
    return { results: [] as T[], success: true, meta: { changes: Number(info.changes) } };
  }
}

export function createTestDb(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const dir = join(process.cwd(), 'migrations');
  for (const file of readdirSync(dir).sort()) {
    raw.exec(readFileSync(join(dir, file), 'utf8'));
  }
  const db = {
    prepare: (sql: string) => new FakeStatement(raw, sql),
    batch: async (statements: FakeStatement[]) => {
      raw.exec('BEGIN');
      try {
        const out = statements.map((s) => s.execAll());
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return { db: db as unknown as D1Database, raw };
}

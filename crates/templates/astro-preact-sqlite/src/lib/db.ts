import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const dataDir = join(process.cwd(), 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

/** `DATABASE_URL=sqlite:data/app.db?mode=rwc` (posé au scaffold) ou `data/app.db`. */
function resolveDbPath(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) {
    const stripped = fromEnv.replace(/^sqlite:/i, '').split('?')[0]?.trim();
    if (stripped) return stripped;
  }
  return join(dataDir, 'app.db');
}

const dbPath = resolveDbPath();
const dbDir = join(dbPath, '..');
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}
export const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const count = db.prepare('SELECT COUNT(*) as count FROM items').get() as { count: number };
if (count.count === 0) {
  const insert = db.prepare('INSERT INTO items (title, description) VALUES (?, ?)');
  insert.run('Exemple 1', 'Premier élément de démo');
  insert.run('Exemple 2', 'Deuxième élément avec SQLite');
  insert.run('Exemple 3', 'Troisième élément pour tester');
}

export interface Item {
  id: number;
  title: string;
  description: string | null;
  created_at: string;
}

export function getAllItems(): Item[] {
  return db.prepare('SELECT * FROM items ORDER BY created_at DESC').all() as Item[];
}

export function getItemById(id: number): Item | undefined {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Item | undefined;
}

export function createItem(title: string, description?: string): Item {
  const result = db.prepare('INSERT INTO items (title, description) VALUES (?, ?)').run(title, description || null);
  return getItemById(result.lastInsertRowid as number)!;
}

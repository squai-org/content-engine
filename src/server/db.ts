import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  type Action,
  DEFAULT_PLANNING,
  DEFAULT_TAXONOMY,
  type Format,
  type Item,
  type Planning,
  type Spec,
  type Status,
  type Taxonomy,
} from './domain.ts';

export type Job = {
  id: string;
  action: Action;
  agent: string;
  item_id: string | null;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  attempts: number;
  run_after: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  item_title?: string | null;
};

export type JobEvent = { id: number; job_id: string; at: string; kind: string; name: string; body: string };

export type Hook = {
  id: string;
  name: string;
  trigger: 'status' | 'weekly';
  status: Status | null;
  weekday: number | null;
  time: string | null;
  action: Action;
  agent: string;
  enabled: boolean;
  last_fired: string | null;
};

export type ItemEvent = { id: number; item_id: string; at: string; kind: string; detail: string };

export type NewItem = {
  title: string;
  message?: string;
  pillar?: string;
  format?: Format;
  service?: string;
  funnel?: string;
  cta?: string;
  scheduled_at?: string | null;
};

type Row = Record<string, unknown>;

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  pillar TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'post',
  service TEXT NOT NULL DEFAULT '',
  funnel TEXT NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  network TEXT NOT NULL DEFAULT 'instagram',
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'idea',
  copy TEXT NOT NULL DEFAULT '',
  spec TEXT,
  assets TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  iteration INTEGER NOT NULL DEFAULT 0,
  permalink TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_scheduled ON items (scheduled_at);
CREATE TABLE IF NOT EXISTS item_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  agent TEXT NOT NULL,
  item_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS job_events_job ON job_events (job_id, id);
CREATE TABLE IF NOT EXISTS hooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT,
  weekday INTEGER,
  time TEXT,
  action TEXT NOT NULL,
  agent TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fired TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const DEFAULT_HOOKS: Omit<Hook, 'last_fired'>[] = [
  {
    id: 'parrilla-semanal',
    name: 'Parrilla semanal',
    trigger: 'weekly',
    status: null,
    weekday: 0,
    time: '18:00',
    action: 'plan',
    agent: 'planner',
    enabled: true,
  },
  {
    id: 'producir-propuesta',
    name: 'Producir propuesta',
    trigger: 'status',
    status: 'idea',
    weekday: null,
    time: null,
    action: 'produce',
    agent: 'productor',
    enabled: true,
  },
  {
    id: 'aplicar-ajustes',
    name: 'Aplicar ajustes',
    trigger: 'status',
    status: 'ajustes',
    weekday: null,
    time: null,
    action: 'revise',
    agent: 'revisor',
    enabled: true,
  },
];

const MAX_EVENT_BODY = 20000;
const KEEP_JOBS = 300;

const ITEM_COLUMNS = [
  'title',
  'message',
  'pillar',
  'format',
  'service',
  'funnel',
  'cta',
  'scheduled_at',
  'status',
  'copy',
  'spec',
  'assets',
  'notes',
  'iteration',
  'permalink',
  'error',
  'first_comment',
] as const;

export type ItemPatch = Partial<Pick<Item, (typeof ITEM_COLUMNS)[number]>>;

function toItem(row: Row): Item {
  return {
    ...(row as unknown as Item),
    spec: row.spec ? (JSON.parse(row.spec as string) as Spec) : null,
    assets: JSON.parse(row.assets as string) as string[],
  };
}

function toHook(row: Row): Hook {
  return { ...(row as unknown as Hook), enabled: row.enabled === 1 };
}

export function createStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const itemColumns = db.prepare('PRAGMA table_info(items)').all() as Row[];
  if (!itemColumns.some((column) => column.name === 'first_comment')) {
    db.exec(`ALTER TABLE items ADD COLUMN first_comment TEXT NOT NULL DEFAULT ''`);
  }
  const insertHook = db.prepare(
    `INSERT OR IGNORE INTO hooks (id, name, trigger, status, weekday, time, action, agent, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const hook of DEFAULT_HOOKS) {
    insertHook.run(
      hook.id,
      hook.name,
      hook.trigger,
      hook.status,
      hook.weekday,
      hook.time,
      hook.action,
      hook.agent,
      hook.enabled ? 1 : 0,
    );
  }
  db.exec(`UPDATE jobs SET status = 'queued' WHERE status = 'running'`);

  const now = () => new Date().toISOString();

  function getItem(id: string): Item | null {
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Row | undefined;
    return row ? toItem(row) : null;
  }

  function addEvent(itemId: string, kind: string, detail = ''): void {
    db.prepare('INSERT INTO item_events (item_id, at, kind, detail) VALUES (?, ?, ?, ?)').run(
      itemId,
      now(),
      kind,
      detail,
    );
  }

  function getSetting<T>(key: string, fallback: T): T {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    return row ? (JSON.parse(row.value as string) as T) : fallback;
  }

  function setSetting(key: string, value: unknown): void {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, JSON.stringify(value));
  }

  return {
    getItem,
    addEvent,
    getSetting,
    setSetting,

    createItem(input: NewItem): Item {
      const id = randomUUID();
      const at = now();
      db.prepare(
        `INSERT INTO items (id, title, message, pillar, format, service, funnel, cta, scheduled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.title,
        input.message ?? '',
        input.pillar ?? '',
        input.format ?? 'post',
        input.service ?? '',
        input.funnel ?? '',
        input.cta ?? '',
        input.scheduled_at ?? null,
        at,
        at,
      );
      addEvent(id, 'creada');
      return getItem(id) as Item;
    },

    listItems(range: { from?: string; to?: string; status?: Status } = {}): Item[] {
      const where: string[] = [];
      const params: string[] = [];
      if (range.from) {
        where.push('(scheduled_at IS NULL OR scheduled_at >= ?)');
        params.push(range.from);
      }
      if (range.to) {
        where.push('(scheduled_at IS NULL OR scheduled_at < ?)');
        params.push(range.to);
      }
      if (range.status) {
        where.push('status = ?');
        params.push(range.status);
      }
      const sql = `SELECT * FROM items ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY scheduled_at IS NULL, scheduled_at, created_at`;
      return (db.prepare(sql).all(...params) as Row[]).map(toItem);
    },

    recentTitles(limit: number): string[] {
      const rows = db
        .prepare('SELECT title FROM items ORDER BY created_at DESC LIMIT ?')
        .all(limit) as Row[];
      return rows.map((row) => row.title as string);
    },

    dueItems(nowIso: string): Item[] {
      const rows = db
        .prepare(
          `SELECT * FROM items WHERE status = 'aprobada' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at`,
        )
        .all(nowIso) as Row[];
      return rows.map(toItem);
    },

    updateItem(id: string, patch: ItemPatch): Item {
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      for (const column of ITEM_COLUMNS) {
        if (!(column in patch)) continue;
        const value = patch[column];
        sets.push(`${column} = ?`);
        if (column === 'spec') params.push(value ? JSON.stringify(value) : null);
        else if (column === 'assets') params.push(JSON.stringify(value));
        else params.push(value as string | number | null);
      }
      sets.push('updated_at = ?');
      params.push(now(), id);
      db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      return getItem(id) as Item;
    },

    deleteItem(id: string): void {
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
      db.prepare('DELETE FROM item_events WHERE item_id = ?').run(id);
      db.prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE item_id = ? AND status = 'queued'`).run(
        now(),
        id,
      );
    },

    listEvents(itemId: string): ItemEvent[] {
      return db
        .prepare('SELECT * FROM item_events WHERE item_id = ? ORDER BY id DESC')
        .all(itemId) as unknown as ItemEvent[];
    },

    enqueue(action: Action, agent: string, itemId: string | null): Job | null {
      if (itemId) {
        const pending = db
          .prepare(
            `SELECT id FROM jobs WHERE item_id = ? AND action = ? AND status IN ('queued', 'running')`,
          )
          .get(itemId, action);
        if (pending) return null;
      }
      const id = randomUUID();
      const at = now();
      db.prepare(
        'INSERT INTO jobs (id, action, agent, item_id, run_after, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, action, agent, itemId, at, at);
      return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as unknown as Job;
    },

    claimJob(nowIso: string): Job | null {
      const row = db
        .prepare(
          `SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY created_at LIMIT 1`,
        )
        .get(nowIso) as Row | undefined;
      if (!row) return null;
      db.prepare(
        `UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1 WHERE id = ?`,
      ).run(nowIso, row.id as string);
      return db.prepare('SELECT * FROM jobs WHERE id = ?').get(row.id as string) as unknown as Job;
    },

    finishJob(id: string): void {
      db.prepare(`UPDATE jobs SET status = 'done', error = NULL, finished_at = ? WHERE id = ?`).run(
        now(),
        id,
      );
    },

    retryJob(id: string, error: string, runAfter: string): void {
      db.prepare(`UPDATE jobs SET status = 'queued', error = ?, run_after = ? WHERE id = ?`).run(
        error,
        runAfter,
        id,
      );
    },

    failJob(id: string, error: string): void {
      db.prepare(`UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`).run(
        error,
        now(),
        id,
      );
    },

    cancelJob(id: string): void {
      db.prepare(
        `UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('queued', 'running')`,
      ).run(now(), id);
    },

    getJob(id: string): Job | null {
      const row = db
        .prepare(
          'SELECT jobs.*, items.title AS item_title FROM jobs LEFT JOIN items ON items.id = jobs.item_id WHERE jobs.id = ?',
        )
        .get(id) as Row | undefined;
      return row ? (row as unknown as Job) : null;
    },

    listJobs(limit = 50): Job[] {
      return db
        .prepare(
          'SELECT jobs.*, items.title AS item_title FROM jobs LEFT JOIN items ON items.id = jobs.item_id ORDER BY jobs.created_at DESC, jobs.rowid DESC LIMIT ?',
        )
        .all(limit) as unknown as Job[];
    },

    latestJob(itemId: string): Job | null {
      const row = db
        .prepare('SELECT * FROM jobs WHERE item_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
        .get(itemId) as Row | undefined;
      return row ? (row as unknown as Job) : null;
    },

    countJobsSince(sinceIso: string): number {
      const row = db.prepare('SELECT COUNT(*) AS total FROM jobs WHERE created_at >= ?').get(sinceIso) as Row;
      return Number(row.total);
    },

    addJobEvent(jobId: string, kind: string, name: string, body: string): void {
      db.prepare('INSERT INTO job_events (job_id, at, kind, name, body) VALUES (?, ?, ?, ?, ?)').run(
        jobId,
        now(),
        kind,
        name,
        body.slice(0, MAX_EVENT_BODY),
      );
    },

    listJobEvents(jobId: string, afterId = 0): JobEvent[] {
      return db
        .prepare('SELECT * FROM job_events WHERE job_id = ? AND id > ? ORDER BY id')
        .all(jobId, afterId) as unknown as JobEvent[];
    },

    pruneJobs(keep = KEEP_JOBS): void {
      db.prepare(
        `DELETE FROM jobs WHERE status IN ('done', 'failed', 'cancelled')
         AND id NOT IN (SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?)`,
      ).run(keep);
      db.exec('DELETE FROM job_events WHERE job_id NOT IN (SELECT id FROM jobs)');
    },

    listHooks(): Hook[] {
      return (db.prepare('SELECT * FROM hooks ORDER BY rowid').all() as Row[]).map(toHook);
    },

    getHook(id: string): Hook | null {
      const row = db.prepare('SELECT * FROM hooks WHERE id = ?').get(id) as Row | undefined;
      return row ? toHook(row) : null;
    },

    updateHook(
      id: string,
      patch: Partial<Pick<Hook, 'enabled' | 'agent' | 'weekday' | 'time' | 'last_fired'>>,
    ): void {
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      if (patch.enabled !== undefined) {
        sets.push('enabled = ?');
        params.push(patch.enabled ? 1 : 0);
      }
      if (patch.agent !== undefined) {
        sets.push('agent = ?');
        params.push(patch.agent);
      }
      if (patch.weekday !== undefined) {
        sets.push('weekday = ?');
        params.push(patch.weekday);
      }
      if (patch.time !== undefined) {
        sets.push('time = ?');
        params.push(patch.time);
      }
      if (patch.last_fired !== undefined) {
        sets.push('last_fired = ?');
        params.push(patch.last_fired);
      }
      if (!sets.length) return;
      params.push(id);
      db.prepare(`UPDATE hooks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    },

    getTaxonomy(): Taxonomy {
      return getSetting('taxonomy', DEFAULT_TAXONOMY);
    },

    getPlanning(): Planning {
      return { ...DEFAULT_PLANNING, ...getSetting<Partial<Planning>>('planning', {}) };
    },

    close(): void {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof createStore>;

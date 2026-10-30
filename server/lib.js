// Base de données et utilitaires partagés par le serveur et l'outil en ligne de commande.
// Aucune dépendance : node:sqlite (Node 22.13+) et node:crypto.
import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
export const ROLES = ['manager', 'tech'];

export function openDb(file = join(DATA_DIR, 'hublot.sqlite')) {
  if (file !== ':memory:') mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('manager', 'tech')), pass TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, ua TEXT
    );
    CREATE TABLE IF NOT EXISTS boats (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL, updated_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by INTEGER);
    CREATE TABLE IF NOT EXISTS counter (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER, action TEXT NOT NULL, detail TEXT);
    INSERT OR IGNORE INTO counter (k, v) VALUES ('seq', 0);
    CREATE INDEX IF NOT EXISTS boats_version ON boats(version);
  `);
  return db;
}

export const now = () => new Date().toISOString();

// ---- mots de passe (scrypt) ------------------------------------------------------
const SC = { N: 16384, r: 8, p: 1, len: 64 };
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const h = scryptSync(String(pw), salt, SC.len, { N: SC.N, r: SC.r, p: SC.p });
  return `scrypt$${SC.N}$${SC.r}$${SC.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function checkPassword(pw, stored) {
  try {
    const [algo, N, r, p, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const want = Buffer.from(hash, 'base64');
    const got = scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
    return timingSafeEqual(want, got);
  } catch { return false; }
}
export function passwordProblem(pw) {
  if (String(pw || '').length < 10) return 'Le mot de passe doit faire au moins 10 caractères.';
  return '';
}

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

// ---- utilisateurs ---------------------------------------------------------------
export function addUser(db, { email, name = '', role = 'manager', password }) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Adresse e-mail invalide.');
  if (!ROLES.includes(role)) throw new Error(`Rôle inconnu : ${role} (manager ou tech).`);
  const pb = passwordProblem(password); if (pb) throw new Error(pb);
  db.prepare('INSERT INTO users (email, name, role, pass, created_at) VALUES (?, ?, ?, ?, ?)').run(e, String(name).trim(), role, hashPassword(password), now());
  return db.prepare('SELECT id, email, name, role FROM users WHERE email = ?').get(e);
}
export function setPassword(db, email, password) {
  const pb = passwordProblem(password); if (pb) throw new Error(pb);
  const r = db.prepare('UPDATE users SET pass = ? WHERE email = ?').run(hashPassword(password), String(email).trim().toLowerCase());
  if (!r.changes) throw new Error('Utilisateur introuvable.');
  db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)').run(String(email).trim().toLowerCase());
}

// ---- données de la flotte ---------------------------------------------------------
const META_KEYS = ['baseName', 'team', 'templates', 'prefs'];
export function nextVersion(db) {
  db.prepare("UPDATE counter SET v = v + 1 WHERE k = 'seq'").run();
  return db.prepare("SELECT v FROM counter WHERE k = 'seq'").get().v;
}
export const currentVersion = (db) => db.prepare("SELECT v FROM counter WHERE k = 'seq'").get().v;

/** Changements depuis une version (0 = tout). */
export function changesSince(db, since = 0) {
  const version = currentVersion(db);
  const m = db.prepare("SELECT data, version FROM meta WHERE k = 'fleet'").get();
  const rows = db.prepare('SELECT id, data, deleted FROM boats WHERE version > ? ORDER BY version').all(since);
  return {
    version,
    meta: m && m.version > since ? JSON.parse(m.data) : null,
    boats: rows.filter((r) => !r.deleted).map((r) => JSON.parse(r.data)),
    deleted: rows.filter((r) => r.deleted).map((r) => r.id),
  };
}

/** Applique un lot de modifications (bateaux complets, suppressions, réglages communs). */
export function applySync(db, userId, { meta, boats = [], deleted = [] }) {
  const at = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (meta && typeof meta === 'object') {
      const clean = Object.fromEntries(META_KEYS.filter((k) => k in meta).map((k) => [k, meta[k]]));
      db.prepare("INSERT INTO meta (k, data, version, updated_at, updated_by) VALUES ('fleet', ?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
        .run(JSON.stringify(clean), nextVersion(db), at, userId);
    }
    const up = db.prepare('INSERT INTO boats (id, data, version, deleted, updated_at, updated_by) VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, version = excluded.version, deleted = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by');
    for (const b of boats) {
      if (!b || typeof b.id !== 'string' || !b.id) continue;
      up.run(b.id, JSON.stringify(b), nextVersion(db), at, userId);
    }
    const del = db.prepare("UPDATE boats SET deleted = 1, data = '{}', version = ?, updated_at = ?, updated_by = ? WHERE id = ? AND deleted = 0");
    for (const id of deleted) if (typeof id === 'string') del.run(nextVersion(db), at, userId, id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return currentVersion(db);
}

/** Remplace toute la flotte par une sauvegarde « cap-depart-backup » (ou un état). */
export function importBackup(db, userId, raw) {
  const d = raw && raw.format === 'cap-depart-backup' && raw.data ? raw.data : raw;
  if (!d || !Array.isArray(d.boats)) throw new Error('Aucun bateau dans ce fichier.');
  const existing = db.prepare('SELECT id FROM boats WHERE deleted = 0').all().map((r) => r.id);
  const ids = new Set(d.boats.map((b) => b.id));
  const team = (d.team || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
  const templates = Array.isArray(d.templates) && d.templates.length ? d.templates : (d.boats.find((b) => b.templates?.length)?.templates || []);
  return applySync(db, userId, {
    meta: { baseName: d.baseName || 'Ma base', team, templates, prefs: { autoDeparture: true, ...(d.prefs || {}) } },
    boats: d.boats.filter((b) => b && b.id),
    deleted: existing.filter((id) => !ids.has(id)),
  });
}

export function audit(db, userId, action, detail = '') {
  db.prepare('INSERT INTO audit (at, user_id, action, detail) VALUES (?, ?, ?, ?)').run(now(), userId ?? null, action, String(detail).slice(0, 500));
}

/** Copie de la base (VACUUM INTO), 14 copies gardées. */
export function backup(db, dir = join(DATA_DIR, 'backups'), keep = 14) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `hublot-${now().slice(0, 10)}.sqlite`);
  try { unlinkSync(file); } catch { /* première copie du jour */ }
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = readdirSync(dir).filter((f) => /^hublot-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
  all.slice(0, Math.max(0, all.length - keep)).forEach((f) => { try { unlinkSync(join(dir, f)); } catch { /* */ } });
  return file;
}

// Serveur Hublot : sert l'application et l'API (connexion, données partagées).
// Lancement : node server/server.js  (variables : PORT, DATA_DIR, COOKIE_SECURE, TRUST_PROXY)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb, now, checkPassword, newToken, sha256, changesSince, applySync, importBackup, audit, backup,
  setPassword, passwordProblem,
} from './lib.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 8080;
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';
const COOKIE = 'cd_sess';
const SESSION_DAYS = 30;
const MAX_BODY = 8 * 1024 * 1024;

export function createApp({ db = openDb(), log = console } = {}) {
  // ---- limites de tentatives de connexion ----------------------------------------
  const fails = new Map();
  const WINDOW = 15 * 60e3;
  // 10 essais par compte, 30 par adresse IP (toute l'équipe peut partager le wifi de la base)
  const blocked = (k) => { const f = fails.get(k); return f && Date.now() - f.first < WINDOW && f.n >= (k.startsWith('ip:') ? 30 : 10); };
  const fail = (k) => { const f = fails.get(k); if (!f || Date.now() - f.first > WINDOW) fails.set(k, { n: 1, first: Date.now() }); else f.n++; };

  const ipOf = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const secure = (req) => (process.env.COOKIE_SECURE === '1' ? true : process.env.COOKIE_SECURE === '0' ? false
    : req.socket.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https')));
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  const setCookie = (req, res, val, maxAge) => res.setHeader('Set-Cookie',
    `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);

  const SEC_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
  const send = (res, code, body, headers = {}) => {
    const json = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(code, { ...SEC_HEADERS, ...(json ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}), ...headers });
    res.end(json ? JSON.stringify(body) : body);
  };
  const readJson = (req) => new Promise((ok, ko) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { ko(Object.assign(new Error('Requête trop volumineuse'), { code: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { ok(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch { ko(Object.assign(new Error('JSON invalide'), { code: 400 })); } });
    req.on('error', ko);
  });

  const userOf = (req) => {
    const tok = cookies(req)[COOKIE];
    if (!tok) return null;
    const row = db.prepare(`SELECT s.token, s.expires_at, u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.disabled = 0`).get(sha256(tok), now());
    return row || null;
  };
  const pub = (u) => ({ id: u.id, email: u.email, name: u.name || u.email.split('@')[0], role: u.role });

  // Requêtes qui modifient : en-tête dédié + même origine (protection CSRF en plus de SameSite=Strict).
  const sameOrigin = (req) => {
    if (req.headers['x-hublot'] !== '1') return false;
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host === (String(req.headers['x-forwarded-host'] || '') || req.headers.host); } catch { return false; }
  };

  async function api(req, res, url) {
    const p = url.pathname;
    if (p === '/api/health') return send(res, 200, { ok: true });
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (mutating && !sameOrigin(req)) return send(res, 403, { error: 'Requête refusée.' });

    if (p === '/api/login' && req.method === 'POST') {
      const b = await readJson(req);
      const email = String(b.email || '').trim().toLowerCase(), ip = ipOf(req);
      if (blocked('ip:' + ip) || blocked('em:' + email)) return send(res, 429, { error: 'Trop de tentatives. Réessaie dans un quart d’heure.' });
      const u = db.prepare('SELECT * FROM users WHERE email = ? AND disabled = 0').get(email);
      if (!u || !checkPassword(b.password, u.pass)) {
        fail('ip:' + ip); fail('em:' + email);
        audit(db, u?.id, 'login-fail', `${email} ${ip}`);
        return send(res, 401, { error: 'E-mail ou mot de passe incorrect.' });
      }
      fails.delete('em:' + email);
      const tok = newToken();
      const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
      db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?)').run(sha256(tok), u.id, now(), exp, ip, String(req.headers['user-agent'] || '').slice(0, 200));
      db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), u.id);
      audit(db, u.id, 'login', ip);
      setCookie(req, res, tok, SESSION_DAYS * 86400);
      return send(res, 200, { user: pub(u) });
    }

    const user = userOf(req);
    if (p === '/api/logout' && req.method === 'POST') {
      if (user) db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);
      setCookie(req, res, '', 0);
      return send(res, 200, { ok: true });
    }
    if (!user) return send(res, 401, { error: 'Connexion requise.' });

    if (p === '/api/me' && req.method === 'GET') {
      // session glissante : prolongée si elle expire dans moins de 25 jours
      if (new Date(user.expires_at) - Date.now() < 25 * 864e5) {
        db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), user.token);
      }
      return send(res, 200, { user: pub(user) });
    }
    if (p === '/api/password' && req.method === 'POST') {
      const b = await readJson(req);
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      if (!checkPassword(b.current, u.pass)) return send(res, 400, { error: 'Mot de passe actuel incorrect.' });
      const pb = passwordProblem(b.next); if (pb) return send(res, 400, { error: pb });
      setPassword(db, u.email, b.next); // ferme toutes les sessions…
      const tok = newToken(); // …puis rouvre celle-ci
      db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?)').run(sha256(tok), u.id, now(), new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), ipOf(req), '');
      setCookie(req, res, tok, SESSION_DAYS * 86400);
      audit(db, u.id, 'password');
      return send(res, 200, { ok: true });
    }
    if (p === '/api/changes' && req.method === 'GET') {
      return send(res, 200, changesSince(db, Math.max(0, parseInt(url.searchParams.get('since'), 10) || 0)));
    }
    // Écriture : réservée au manager pour l'instant (les accès technicien viendront ensuite).
    if (user.role !== 'manager') return send(res, 403, { error: 'Accès en lecture seule pour ce compte.' });
    if (p === '/api/sync' && req.method === 'POST') {
      const b = await readJson(req);
      const version = applySync(db, user.id, b);
      return send(res, 200, { version });
    }
    if (p === '/api/import' && req.method === 'POST') {
      const b = await readJson(req);
      backup(db);
      const version = importBackup(db, user.id, b);
      audit(db, user.id, 'import', `${(b.data || b).boats?.length || 0} bateaux`);
      return send(res, 200, { version });
    }
    return send(res, 404, { error: 'Introuvable.' });
  }

  // ---- fichiers de l'application ---------------------------------------------------
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
  const ALLOWED = /^\/(index\.html|manifest\.webmanifest|sw\.js|(src|styles|icons)\/[\w./-]+)$/;
  async function file(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    if (!ALLOWED.test(p) || p.includes('..')) return send(res, 404, 'Introuvable', { 'Content-Type': 'text/plain; charset=utf-8' });
    const full = normalize(join(ROOT, p));
    if (!full.startsWith(ROOT)) return send(res, 404, 'Introuvable', { 'Content-Type': 'text/plain; charset=utf-8' });
    try {
      const st = await stat(full);
      if (!st.isFile()) throw new Error('not file');
      const body = await readFile(full);
      return send(res, 200, body, { 'Content-Type': TYPES[extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    } catch { return send(res, 404, 'Introuvable', { 'Content-Type': 'text/plain; charset=utf-8' }); }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await file(req, res, url);
      else send(res, 405, { error: 'Méthode non autorisée.' });
    } catch (e) {
      if (!res.headersSent) send(res, e.code >= 400 && e.code < 500 ? e.code : 500, { error: e.code ? e.message : 'Erreur du serveur.' });
      if (!e.code) log.error?.(e);
    }
  });

  // Ménage et sauvegardes
  const housekeeping = () => {
    try {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
      const today = now().slice(0, 10);
      if (db.__lastBackup !== today) { backup(db); db.__lastBackup = today; }
    } catch (e) { log.error?.('Sauvegarde impossible', e.message); }
  };
  return { server, db, housekeeping };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const { server, db, housekeeping } = createApp();
  const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  housekeeping();
  setInterval(housekeeping, 3 * 3600e3).unref();
  server.listen(PORT, () => {
    console.log(`Hublot écoute sur le port ${PORT} · données : ${process.env.DATA_DIR || join(process.cwd(), 'data')}`);
    if (!users) console.log('Aucun compte : crée le compte manager avec « node server/cli.js add-user ton@email.fr --name Prénom ».');
  });
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

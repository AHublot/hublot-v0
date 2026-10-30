import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hublot-'));
process.env.COOKIE_SECURE = '0';
const { createApp } = await import('../server/server.js');
const { openDb, addUser } = await import('../server/lib.js');

const db = openDb(':memory:');
addUser(db, { email: 'chef@base.fr', name: 'Chef', role: 'manager', password: 'motdepasse-solide' });
addUser(db, { email: 'tech@base.fr', name: 'Tech', role: 'tech', password: 'motdepasse-tech1' });
const { server } = createApp({ db, log: { error() {} } });
await new Promise((ok) => server.listen(0, ok));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const H = { 'Content-Type': 'application/json', 'X-Hublot': '1' };
const post = (p, body, extra = {}) => fetch(base + p, { method: 'POST', headers: { ...H, ...extra }, body: JSON.stringify(body) });
async function login(email, password) {
  const r = await post('/api/login', { email, password });
  const c = r.headers.get('set-cookie') || '';
  return { r, cookie: c.split(';')[0], raw: c };
}

test('fichiers : l’application est servie, le reste non', async () => {
  const idx = await fetch(base + '/');
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /Hublot/);
  assert.match(idx.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const p of ['/server/lib.js', '/data/hublot.sqlite', '/tests/core.test.mjs', '/package.json', '/src/../server/lib.js', '/.git/config']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  assert.equal((await fetch(base + '/src/app.js')).status, 200);
});

test('connexion : refus, cookie sûr, déconnexion', async () => {
  assert.equal((await fetch(base + '/api/changes')).status, 401);
  assert.equal((await login('chef@base.fr', 'mauvais')).r.status, 401);
  const ok = await login('CHEF@base.fr', 'motdepasse-solide');
  assert.equal(ok.r.status, 200);
  assert.match(ok.raw, /HttpOnly/);
  assert.match(ok.raw, /SameSite=Strict/);
  const me = await fetch(base + '/api/me', { headers: { cookie: ok.cookie } });
  assert.equal((await me.json()).user.role, 'manager');
  await post('/api/logout', {}, { cookie: ok.cookie });
  assert.equal((await fetch(base + '/api/me', { headers: { cookie: ok.cookie } })).status, 401);
});

test('protection : en-tête obligatoire et même origine', async () => {
  const { cookie } = await login('chef@base.fr', 'motdepasse-solide');
  const noHeader = await fetch(base + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}' });
  assert.equal(noHeader.status, 403);
  const otherOrigin = await post('/api/sync', {}, { cookie, Origin: 'https://pirate.example' });
  assert.equal(otherOrigin.status, 403);
});

test('synchronisation : envoi, changements depuis une version, suppression', async () => {
  const { cookie } = await login('chef@base.fr', 'motdepasse-solide');
  const r1 = await post('/api/sync', { meta: { baseName: 'Marin', team: ['Léa'], templates: ['Ranger'], prefs: {} }, boats: [{ id: 'b1', name: 'Aurore' }, { id: 'b2', name: 'Bora' }] }, { cookie });
  const { version: v1 } = await r1.json();
  const all = await (await fetch(base + '/api/changes?since=0', { headers: { cookie } })).json();
  assert.equal(all.boats.length, 2);
  assert.equal(all.meta.baseName, 'Marin');
  const none = await (await fetch(`${base}/api/changes?since=${v1}`, { headers: { cookie } })).json();
  assert.equal(none.boats.length, 0);
  assert.equal(none.meta, null);
  await post('/api/sync', { boats: [{ id: 'b1', name: 'Aurore II' }], deleted: ['b2'] }, { cookie });
  const ch = await (await fetch(`${base}/api/changes?since=${v1}`, { headers: { cookie } })).json();
  assert.deepEqual(ch.boats.map((b) => b.name), ['Aurore II']);
  assert.deepEqual(ch.deleted, ['b2']);
});

test('import d’une sauvegarde : remplace la flotte', async () => {
  const { cookie } = await login('chef@base.fr', 'motdepasse-solide');
  const r = await post('/api/import', { format: 'cap-depart-backup', data: { boats: [{ id: 'x1', name: 'Ondine' }], team: ['Lucas'] } }, { cookie });
  assert.equal(r.status, 200);
  const all = await (await fetch(base + '/api/changes?since=0', { headers: { cookie } })).json();
  assert.deepEqual(all.boats.map((b) => b.name), ['Ondine']);
  assert.deepEqual(all.meta.team, ['Lucas']);
});

test('compte technicien : lecture seule pour l’instant', async () => {
  const { cookie } = await login('tech@base.fr', 'motdepasse-tech1');
  assert.equal((await fetch(base + '/api/changes?since=0', { headers: { cookie } })).status, 200);
  assert.equal((await post('/api/sync', { boats: [] }, { cookie })).status, 403);
});

test('changement de mot de passe', async () => {
  const { cookie } = await login('tech@base.fr', 'motdepasse-tech1');
  assert.equal((await post('/api/password', { current: 'faux', next: 'nouveau-mdp-123' }, { cookie })).status, 400);
  assert.equal((await post('/api/password', { current: 'motdepasse-tech1', next: 'court' }, { cookie })).status, 400);
  const ok = await post('/api/password', { current: 'motdepasse-tech1', next: 'nouveau-mdp-123' }, { cookie });
  assert.equal(ok.status, 200);
  assert.equal((await login('tech@base.fr', 'nouveau-mdp-123')).r.status, 200);
});

test('limite de tentatives', async () => {
  for (let i = 0; i < 10; i++) await login('inconnu@base.fr', 'x');
  assert.equal((await login('inconnu@base.fr', 'x')).r.status, 429);
});

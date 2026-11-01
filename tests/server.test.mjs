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

test('compte technicien : ne peut pas envoyer de bateaux entiers', async () => {
  const { cookie } = await login('tech@base.fr', 'motdepasse-tech1');
  assert.equal((await fetch(base + '/api/changes?since=0', { headers: { cookie } })).status, 200);
  assert.equal((await post('/api/sync', { boats: [{ id: 'z', name: 'Z' }] }, { cookie })).status, 403);
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

test('modifications fusionnées : technicien et manager sur le même bateau', async () => {
  const mgr = (await login('chef@base.fr', 'motdepasse-solide')).cookie;
  // création du compte technicien depuis le site
  const cr = await post('/api/users', { email: 'Marc@base.fr', name: 'Marc', role: 'tech' }, { cookie: mgr });
  assert.equal(cr.status, 200);
  const { password: temp } = await cr.json();
  assert.equal(temp.length, 12);
  // compte provisoire : tout est bloqué sauf le changement de mot de passe
  const t0 = await login('marc@base.fr', temp);
  assert.equal(t0.r.status, 200);
  const blocked = await fetch(base + '/api/changes?since=0', { headers: { cookie: t0.cookie } });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'must_change');
  assert.equal((await post('/api/password', { current: temp, next: temp }, { cookie: t0.cookie })).status, 400);
  assert.equal((await post('/api/password', { current: temp, next: 'marc-mot-de-passe' }, { cookie: t0.cookie })).status, 200);
  const tech = (await login('marc@base.fr', 'marc-mot-de-passe')).cookie;
  assert.equal((await (await fetch(base + '/api/me', { headers: { cookie: tech } })).json()).user.mustChange, false);

  await post('/api/sync', { boats: [{ id: 'f1', name: 'Fée', departure: '', hours: null, tasks: [{ id: 'a', title: 'Pont', template: 'Pont', done: false, blocked: false }, { id: 'b', title: 'Pompe', done: false, blocked: false }], maintenance: [{ id: 'm', title: 'Survie', date: '', hours: '', notes: '' }], logs: [], history: [], pendingOnReturn: [] }] }, { cookie: mgr });
  const get = async () => (await (await fetch(base + '/api/boat?id=f1', { headers: { cookie: mgr } })).json()).boat;

  // le technicien coche, ajoute une observation, note un entretien
  const r = await post('/api/sync', { patches: [{ id: 'f1', ops: [
    { op: 'upd', a: 'tasks', key: 'ib', set: { done: true, doneAt: 'x', doneBy: 'Pirate' }, unset: [] },
    { op: 'add', a: 'tasks', key: 'in', item: { id: 'n', title: 'Fuite douche', done: false, blocked: false, addedBy: 'Pirate' } },
    { op: 'upd', a: 'maintenance', key: 'im', set: { date: '2026-11-01' }, unset: [] },
  ] }] }, { cookie: tech });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).rejected, []);
  // le manager, en même temps, change une date et ajoute une tâche
  await post('/api/sync', { patches: [{ id: 'f1', ops: [
    { op: 'set', k: 'departure', v: '2026-11-07T17:00' },
    { op: 'add', a: 'tasks', key: 'iq', item: { id: 'q', title: 'Voile', done: false, blocked: false } },
  ] }] }, { cookie: mgr });
  const b = await get();
  assert.equal(b.tasks.find((t) => t.id === 'b').done, true);
  assert.equal(b.tasks.find((t) => t.id === 'b').doneBy, 'Marc');
  assert.equal(b.tasks.find((t) => t.id === 'n').addedBy, 'Marc');
  assert.equal(b.tasks.find((t) => t.id === 'q').addedBy, 'Chef');
  assert.equal(b.maintenance[0].by, 'Marc');
  assert.equal(b.departure, '2026-11-07T17:00');

  // ce qu'un technicien n'a pas le droit de faire est refusé, le reste passe
  const bad = await post('/api/sync', { patches: [{ id: 'f1', ops: [
    { op: 'set', k: 'departure', v: '2030-01-01T00:00' },
    { op: 'upd', a: 'tasks', key: 'ib', set: { bill: true }, unset: [] },
    { op: 'del', a: 'tasks', key: 'ia' },
    { op: 'upd', a: 'tasks', key: 'in', set: { blocked: true }, unset: [] },
  ] }] }, { cookie: tech });
  assert.deepEqual((await bad.json()).rejected, ['f1']);
  const b2 = await get();
  assert.equal(b2.departure, '2026-11-07T17:00');
  assert.equal(b2.tasks.find((t) => t.id === 'b').bill, undefined);
  assert.ok(b2.tasks.find((t) => t.id === 'a'), 'tâche habituelle conservée');
  assert.equal(b2.tasks.find((t) => t.id === 'n').blocked, true);

  // bateau disparu : signalé
  const gone = await post('/api/sync', { patches: [{ id: 'inconnu', ops: [{ op: 'set', k: 'name', v: 'x' }] }] }, { cookie: mgr });
  assert.deepEqual((await gone.json()).rejected, ['inconnu']);
  // un technicien n'accède ni à la liste des comptes ni aux réglages communs
  assert.equal((await fetch(base + '/api/users', { headers: { cookie: tech } })).status, 403);
  assert.equal((await post('/api/sync', { meta: { team: [] } }, { cookie: tech })).status, 403);
});

test('comptes : réinitialisation, désactivation, garde-fous', async () => {
  const mgr = (await login('chef@base.fr', 'motdepasse-solide')).cookie;
  const list = async () => (await (await fetch(base + '/api/users', { headers: { cookie: mgr } })).json()).users;
  const marc = (await list()).find((u) => u.email === 'marc@base.fr');
  assert.equal((await post('/api/users', { email: 'marc@base.fr', name: 'Bis', role: 'tech' }, { cookie: mgr })).status, 400);
  const rs = await (await post('/api/users/reset', { id: marc.id }, { cookie: mgr })).json();
  assert.equal((await login('marc@base.fr', 'marc-mot-de-passe')).r.status, 401);
  assert.equal((await login('marc@base.fr', rs.password)).r.status, 200);
  await post('/api/users/update', { id: marc.id, disabled: true }, { cookie: mgr });
  assert.equal((await login('marc@base.fr', rs.password)).r.status, 401);
  const chef = (await list()).find((u) => u.email === 'chef@base.fr');
  const self = await post('/api/users/update', { id: chef.id, disabled: true }, { cookie: mgr });
  assert.equal(self.status, 400);
  assert.equal((await post('/api/users/update', { id: chef.id, role: 'tech' }, { cookie: mgr })).status, 400);
});

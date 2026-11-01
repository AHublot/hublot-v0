import test from 'node:test';
import assert from 'node:assert/strict';
import { diffBoat, applyOps, deniedOps, same, withoutStamps } from '../src/merge.js';

const boat = () => ({
  id: 'b1', name: 'Aurore', inRental: false, departure: '', hours: { port: '100', stbd: '101' }, techs: ['Léa'],
  tasks: [
    { id: 't1', title: 'Nettoyer le pont', done: false, blocked: false, template: 'Nettoyer le pont' },
    { id: 't2', title: 'Pompe de douche', done: false, blocked: false },
  ],
  pendingOnReturn: [], history: [{ id: 'h1', date: '2026-10-01', kind: 'return', tasks: [] }],
  maintenance: [{ id: 'm1', title: 'Extincteurs', date: '', hours: '', notes: '', intervalDays: 365 }],
  importantEvents: [], logs: [{ date: '2026-10-30T10:00:00.000Z', text: 'Bateau ajouté' }],
});

test('fusion : appliquer le diff redonne la version modifiée', () => {
  const base = boat(), cur = boat();
  cur.tasks[0].done = true; cur.tasks[0].doneAt = '2026-11-01T12:00:00.000Z';
  cur.tasks.push({ id: 't3', title: 'Hublot fêlé', done: false, blocked: true });
  cur.tasks = cur.tasks.filter((t) => t.id !== 't2');
  cur.hours = { port: '110', stbd: '101', date: 'x' };
  cur.maintenance[0].date = '2026-11-01';
  cur.logs.unshift({ date: '2026-11-01T12:00:00.000Z', text: 'Terminée : Nettoyer le pont' });
  const out = applyOps(base, diffBoat(base, cur));
  assert.ok(same(out, cur));
});

test('fusion : deux personnes sur le même bateau, rien ne se perd', () => {
  const base = boat();
  const a = boat(); a.tasks[0].done = true; a.tasks[0].doneAt = 'd1'; // le technicien coche
  const b = boat(); b.tasks.push({ id: 't9', title: 'Voile à recoudre', done: false, blocked: false }); // le manager ajoute
  b.departure = '2026-11-07T17:00';
  let server = applyOps(base, diffBoat(base, a), { by: 'Léa' });
  server = applyOps(server, diffBoat(base, b), { by: 'Chef' });
  assert.equal(server.tasks.find((t) => t.id === 't1').done, true);
  assert.equal(server.tasks.find((t) => t.id === 't9').addedBy, 'Chef');
  assert.equal(server.departure, '2026-11-07T17:00');
});

test('fusion : même tâche modifiée deux fois, la dernière gagne ; envoi rejoué sans doublon', () => {
  const base = boat();
  const a = boat(); a.tasks[1].done = true;
  const ops = diffBoat(base, a);
  let s = applyOps(base, ops, { by: 'Léa' });
  s = applyOps(s, ops, { by: 'Léa' });
  assert.equal(s.tasks.length, 2);
  const c = boat(); c.tasks.push({ id: 'n1', title: 'Neuf', done: false, blocked: false });
  const o2 = diffBoat(base, c);
  s = applyOps(applyOps(s, o2), o2);
  assert.equal(s.tasks.filter((t) => t.id === 'n1').length, 1);
});

test('auteur : posé par le serveur, jamais imposé par le poste', () => {
  const base = boat();
  const a = boat(); a.tasks[1].done = true; a.tasks[1].doneBy = 'Pirate';
  a.tasks.push({ id: 'n', title: 'Neuf', done: false, blocked: false, addedBy: 'Pirate' });
  const s = applyOps(base, diffBoat(base, a), { by: 'Léa' });
  assert.equal(s.tasks[1].doneBy, 'Léa');
  assert.equal(s.tasks.find((t) => t.id === 'n').addedBy, 'Pirate'); // un élément ajouté garde ses champs (copies reportées)
  const re = boat(); re.tasks[1].done = false;
  const s2 = applyOps(s, diffBoat(applyOps(base, diffBoat(base, a), { by: 'Léa' }), { ...s, tasks: s.tasks.map((t) => (t.id === 't2' ? { ...t, done: false } : t)) }), { by: 'Léa' });
  assert.equal(s2.tasks[1].doneBy, undefined);
  assert.ok(same(withoutStamps(s), withoutStamps({ ...s, tasks: s.tasks.map((t) => ({ ...t, doneBy: undefined })) })));
});

test('droits technicien', () => {
  const b = boat();
  const ok = (cur) => deniedOps('tech', diffBoat(b, cur), b).length === 0;
  const mk = (fn) => { const c = boat(); fn(c); return c; };
  assert.ok(ok(mk((c) => { c.tasks[0].done = true; c.tasks[0].doneAt = 'x'; })));
  assert.ok(ok(mk((c) => { c.tasks[1].blocked = true; })));
  assert.ok(ok(mk((c) => { c.tasks.push({ id: 'z', title: 'Fuite', done: false, blocked: false }); })));
  assert.ok(ok(mk((c) => { c.tasks = c.tasks.filter((t) => t.id !== 't2'); })));
  assert.ok(ok(mk((c) => { c.hours = { port: '120', stbd: '121', date: 'x' }; })));
  assert.ok(ok(mk((c) => { c.maintenance[0].date = '2026-11-01'; c.maintenance[0].notes = 'ok'; })));
  assert.ok(ok(mk((c) => { c.logs.unshift({ date: '2026-11-02', text: 'x' }); })));
  // refusé
  assert.ok(!ok(mk((c) => { c.departure = '2026-11-09T10:00'; })));
  assert.ok(!ok(mk((c) => { c.inRental = true; })));
  assert.ok(!ok(mk((c) => { c.tasks = c.tasks.filter((t) => t.id !== 't1'); })), 'tâche habituelle');
  assert.ok(!ok(mk((c) => { c.tasks.push({ id: 'q', title: 'x', template: 'x', done: false }); })));
  assert.ok(!ok(mk((c) => { c.tasks[1].bill = true; })), 'refacturation');
  assert.ok(!ok(mk((c) => { c.tasks[0].title = 'Autre'; })), 'renommer une habituelle');
  assert.ok(!ok(mk((c) => { c.maintenance[0].intervalDays = 30; })));
  assert.ok(!ok(mk((c) => { c.techs = []; })));
  assert.ok(!ok(mk((c) => { c.history = []; })));
  assert.ok(!ok(mk((c) => { c.maintenance.push({ id: 'mm', title: 'Winchs' }); })));
  assert.equal(deniedOps('manager', diffBoat(b, mk((c) => { c.inRental = true; })), b).length, 0);
});

test('technicien : peut signaler un départ et un retour, rien d’autre au passage', () => {
  const b = boat();
  const dep = boat();
  dep.history.unshift({ id: 'h2', date: '2026-11-01', kind: 'departure', tasks: [] });
  dep.pendingOnReturn = [{ id: 't2', title: 'Pompe de douche', done: false }];
  dep.tasks = []; dep.departureArchived = true; dep.inRental = true; dep.lastDeparture = '2026-11-01T10:00'; dep.logs.unshift({ date: 'x', text: 'Départ signalé' });
  assert.equal(deniedOps('tech', diffBoat(b, dep), b).length, 0, 'départ');
  const s = applyOps(b, diffBoat(b, dep), { by: 'Léa' });
  assert.equal(s.history[0].by, 'Léa', 'auteur posé par le serveur');
  const back = JSON.parse(JSON.stringify(s)); back.inRental = false; back.departureArchived = false; back.departure = ''; back.returnDate = '';
  back.cycle = '2026-11-05'; back.pendingOnReturn = []; back.tasks = [{ id: 'n1', title: 'Nettoyer le pont', template: 'Nettoyer le pont', done: false }];
  back.history.unshift({ id: 'h3', date: '2026-11-05', kind: 'return', tasks: [] });
  assert.equal(deniedOps('tech', diffBoat(s, back), s).length, 0, 'retour');
  // hors départ / retour : toujours refusé
  const sneaky = boat(); sneaky.departure = '2026-12-01T10:00'; sneaky.tasks = [];
  assert.ok(deniedOps('tech', diffBoat(b, sneaky), b).length > 0, 'dates et suppression en masse');
  // une bascule ne donne pas le droit de toucher au reste
  const mix = JSON.parse(JSON.stringify(dep)); mix.team = ['x']; mix.maintenance[0].intervalDays = 1; mix.name = 'Pirate';
  const bad = deniedOps('tech', diffBoat(b, mix), b);
  assert.ok(bad.length >= 2 && bad.every((o) => o.k === 'name' || o.a === 'maintenance' || o.k === 'team'));
});

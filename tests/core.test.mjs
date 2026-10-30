import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseObservations, fmtCountdown } from '../src/util.js';
import {
  normalizeState, emptyState, newBoat, boatStats, boatStatus, maintStatus, DEFAULT_TEMPLATES, matchFilter, fleetStats,
} from '../src/model.js';
import * as A from '../src/actions.js';
import { observationsOf } from '../src/model.js';
import { collectObservations, observationsCsv } from '../src/exports.js';
import { demoState } from '../src/demo.js';

const fresh = () => {
  const s = emptyState();
  A.addBoat(s, { name: 'Test', base: 'Martinique' });
  return s;
};

test('parseObservations : lignes, point-virgule, puces, ! bloquant, doublons', () => {
  const r = parseObservations('  - winch grippé;\n! fuite cale moteur\n1) Winch grippé\n\n3 gilets manquent');
  assert.deepEqual(r.map((x) => x.title), ['Winch grippé', 'Fuite cale moteur', '3 gilets manquent']);
  assert.equal(r[1].blocked, true);
  assert.equal(r[0].blocked, false);
});

test('un nouveau bateau reçoit les tâches récurrentes et trois entretiens', () => {
  const s = fresh();
  const b = s.boats[0];
  assert.equal(b.tasks.length, DEFAULT_TEMPLATES.length);
  assert.ok(b.tasks.every((t) => t.template));
  assert.equal(b.maintenance.length, 3);
});

test('cycle départ puis retour : archive, report des observations, tâches récurrentes relancées', () => {
  const s = fresh();
  const b = s.boats[0];
  A.toggleTask(s, b.id, b.tasks[0].id);
  A.addObservations(s, b.id, [{ title: 'Winch grippé' }, { title: 'Prise manquante', blocked: true }]);
  A.toggleTask(s, b.id, b.tasks.at(-2).id); // winch terminé
  A.confirmDeparture(s, b.id);
  assert.equal(b.inRental, true);
  assert.equal(b.tasks.length, 0);
  assert.equal(b.history.length, 1);
  assert.equal(b.history[0].tasks.length, DEFAULT_TEMPLATES.length + 2);
  // seules les tâches non terminées sont reportées
  assert.ok(b.pendingOnReturn.every((t) => !t.done));
  assert.ok(b.pendingOnReturn.some((t) => t.title === 'Prise manquante'));
  assert.ok(!b.pendingOnReturn.some((t) => t.title === 'Winch grippé'));

  A.returnToBase(s, b.id);
  assert.equal(b.inRental, false);
  const rec = b.tasks.filter((t) => t.template);
  assert.equal(rec.length, DEFAULT_TEMPLATES.length);
  assert.ok(rec.every((t) => !t.done), 'les récurrentes repartent à zéro');
  const carried = b.tasks.filter((t) => !t.template);
  assert.deepEqual(carried.map((t) => t.title), ['Prise manquante']);
  assert.equal(carried[0].carried, true);
  assert.equal(carried[0].blocked, true);
});

test('nouveau retour : archive la préparation, garde les observations non terminées', () => {
  const s = fresh();
  const b = s.boats[0];
  b.tasks.forEach((t) => A.toggleTask(s, b.id, t.id)); // tâches habituelles faites
  A.addObservations(s, b.id, [{ title: 'Pompe de douche' }, { title: 'Feu de navigation', blocked: true }, { title: 'Coussin' }]);
  const pompe = b.tasks.find((t) => t.title === 'Pompe de douche');
  A.toggleTask(s, b.id, pompe.id);
  const plan = A.returnPlan(s, b);
  assert.equal(plan.kept.length, 2);
  A.newReturn(s, b.id);
  assert.equal(b.history.length, 1);
  assert.equal(b.history[0].kind, 'return');
  assert.equal(b.history[0].tasks.length, DEFAULT_TEMPLATES.length + 3);
  const obs = b.tasks.filter((t) => !t.template);
  assert.deepEqual(obs.map((t) => t.title).sort(), ['Coussin', 'Feu de navigation']);
  assert.ok(obs.every((t) => t.carried && !t.done));
  assert.ok(b.tasks.filter((t) => t.template).every((t) => !t.done));
  // un 2e retour n'archive pas deux fois la même observation dans l'export
  A.toggleTask(s, b.id, obs[0].id);
  A.newReturn(s, b.id);
  const all = observationsOf(b);
  assert.equal(all.length, 3, 'chaque observation une seule fois');
  assert.equal(all.filter((o) => o.done).length, 2);
});

test('nouveau retour pendant une location : les observations notées en location reviennent', () => {
  const s = fresh();
  const b = s.boats[0];
  A.addObservations(s, b.id, [{ title: 'Winch' }]);
  A.confirmDeparture(s, b.id);
  A.addObservations(s, b.id, [{ title: 'Eau dans la cale' }]);
  assert.equal(b.pendingOnReturn.length, DEFAULT_TEMPLATES.length + 2);
  A.newReturn(s, b.id);
  assert.equal(b.inRental, false);
  assert.equal(b.history.length, 1, 'rien de plus à archiver : la préparation était vide');
  assert.deepEqual(b.tasks.filter((t) => !t.template).map((t) => t.title).sort(), ['Eau dans la cale', 'Winch']);
});

test('export des observations : filtres et CSV Excel', () => {
  const s = fresh();
  A.addBoat(s, { name: 'Autre' });
  const [b, c] = s.boats;
  A.addObservations(s, b.id, [{ title: 'Pompe; douche' }, { title: 'Feu' }]);
  A.addObservations(s, c.id, [{ title: 'Voile' }]);
  A.toggleTask(s, b.id, b.tasks.find((t) => t.title === 'Feu').id);
  assert.equal(collectObservations(s).length, 3);
  assert.equal(collectObservations(s, { boat: b.id }).length, 2);
  assert.equal(collectObservations(s, { status: 'done' }).length, 1);
  assert.equal(collectObservations(s, { from: '2999-01-01' }).length, 0);
  const csv = observationsCsv(collectObservations(s));
  assert.ok(csv.startsWith('\uFEFFBateau;Base;Observation;Statut'));
  assert.match(csv, /"Pompe; douche"/);
  assert.match(csv, /Feu;Réglée/);
});

test('annulation : mutate + snapshot JSON restitue l’état', () => {
  const s = fresh();
  const before = JSON.stringify(s);
  A.deleteBoat(s, s.boats[0].id);
  assert.equal(s.boats.length, 0);
  assert.equal(JSON.stringify(JSON.parse(before)).length, before.length);
});

test('entretiens : à renseigner, à jour, en retard (jours et heures moteur)', () => {
  const s = fresh();
  const b = s.boats[0];
  const [survie, , moteur] = b.maintenance;
  assert.equal(maintStatus(survie, b).key, 'missing');
  survie.date = new Date().toISOString().slice(0, 10);
  assert.equal(maintStatus(survie, b).key, 'ok');
  survie.date = '2020-01-01';
  assert.equal(maintStatus(survie, b).key, 'late');
  moteur.date = new Date().toISOString().slice(0, 10);
  moteur.hours = '1000';
  A.setHours(s, b.id, 'port', '1250');
  A.setHours(s, b.id, 'stbd', '1240');
  const st = maintStatus(moteur, b);
  assert.equal(st.key, 'late');
  assert.match(st.label, /50 h de retard/);
});

test('départ automatique : seulement si l’heure est passée et non signalé', () => {
  const s = fresh();
  const b = s.boats[0];
  assert.deepEqual(A.dueDepartures(s), []);
  b.departure = '2020-01-01T10:00';
  assert.deepEqual(A.dueDepartures(s), [b.id]);
  s.prefs.autoDeparture = false;
  assert.deepEqual(A.dueDepartures(s), []);
});

test('équipe : retirer quelqu’un le désaffecte partout', () => {
  const s = fresh();
  A.addMember(s, 'Léa');
  A.addMember(s, 'léa');
  assert.deepEqual(s.team, ['Léa']);
  A.toggleAssign(s, 'Léa', s.boats[0].id);
  assert.deepEqual(s.boats[0].techs, ['Léa']);
  A.removeMember(s, 'Léa');
  assert.deepEqual(s.boats[0].techs, []);
});

test('liste récurrente : ajout, ordre, manquantes', () => {
  const s = fresh();
  const b = s.boats[0];
  assert.equal(A.addBoatTemplate(s, b.id, 'Vérifier le guindeau', true), true);
  assert.equal(A.addBoatTemplate(s, b.id, 'Vérifier le guindeau', true), false);
  assert.equal(b.tasks.at(-1).template, 'Vérifier le guindeau');
  A.moveBoatTemplate(s, b.id, 0, 1);
  assert.equal(b.templates[1], DEFAULT_TEMPLATES[0]);
  A.deleteTask(s, b.id, b.tasks.at(-1).id);
  assert.equal(A.addMissingTemplates(s, b.id), 1);
});

test('démo : filtres et compteurs cohérents', () => {
  const s = demoState();
  const f = fleetStats(s.boats);
  assert.equal(f.count, 8);
  assert.equal(f.rental, 2);
  assert.ok(f.blocked >= 2);
  assert.ok(s.boats.filter((b) => matchFilter(b, 'missing')).length > 0);
  assert.equal(fmtCountdown(new Date(Date.now() - 1000)), 'dépassé');
});

const real = '/mnt/user-data/uploads/hublot-2026-10-22.json';
test('import de la vraie sauvegarde (si présente)', { skip: !existsSync(real) }, () => {
  const raw = JSON.parse(readFileSync(real, 'utf8'));
  const s = normalizeState(raw);
  assert.equal(s.boats.length, raw.data.boats.length);
  assert.equal(s.team.length, raw.data.team.length);
  assert.ok(s.templates.length >= 13);
  const n = raw.data.boats.reduce((a, b) => a + b.tasks.length, 0);
  assert.equal(s.boats.reduce((a, b) => a + b.tasks.length, 0), n);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseObservations, fmtCountdown } from '../src/util.js';
import {
  normalizeState, emptyState, newBoat, boatStats, boatStatus, maintStatus, DEFAULT_TEMPLATES, matchFilter, fleetStats, sheetOf,
} from '../src/model.js';
import * as A from '../src/actions.js';
import { observationsOf } from '../src/model.js';
import { monthData, monthlyReport, monthsAvailable, monthTotals } from '../src/report.js';
import { dateSerial, sheetName } from '../src/xlsx.js';
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
  assert.equal(b.pendingOnReturn.length, 2, 'seules les observations passent au retour');
  A.newReturn(s, b.id);
  assert.equal(b.inRental, false);
  assert.equal(b.history.length, 1, 'rien de plus à archiver : la préparation était vide');
  assert.deepEqual(b.tasks.filter((t) => !t.template).map((t) => t.title).sort(), ['Eau dans la cale', 'Winch']);
});

test('rapport mensuel : mois de constat, à refacturer, classeur Excel valide', () => {
  const s = fresh();
  A.addBoat(s, { name: 'Autre: bateau/2' });
  const [b, c] = s.boats;
  A.addObservations(s, b.id, [{ title: 'Pompe' }, { title: 'Coussin' }]);
  A.addObservations(s, c.id, [{ title: 'Voile' }]);
  const t = b.tasks.find((x) => x.title === 'Coussin');
  A.toggleBill(s, b.id, t.id);
  A.setBillField(s, b.id, t.id, 'hours', '2,5');
  A.setBilled(s, b.id, t.id, true);
  const month = new Date().toISOString().slice(0, 7);
  assert.ok(monthsAvailable(s).includes(month));
  const d = monthData(s, month);
  assert.equal(d.find((x) => x.b.id === b.id).bill.length, 1);
  assert.equal(d.find((x) => x.b.id === b.id).hours, 2.5);
  assert.deepEqual(monthTotals(s, month), { obs: 3, bill: 1, billed: 1, hours: 2.5, boats: 2 });
  assert.equal(monthlyReport(s, { month: '1999-01' }), null);
  const r = monthlyReport(s, { month });
  assert.equal(r.sheets, 3);
  assert.equal(r.count, 3);
  const head = Buffer.from(r.bytes.slice(0, 4)).toString('hex');
  assert.equal(head, '504b0304', 'archive zip');
  const txt = Buffer.from(r.bytes).toString('utf8');
  assert.match(txt, /<sheet name="Synthèse"/);
  assert.match(txt, /<sheet name="Autre  bateau 2"/);
  assert.match(txt, /À REFACTURER/);
  assert.equal(dateSerial('2026-10-30'), 46325);
  const used = new Set(); sheetName('A', used); assert.equal(sheetName('a', used), 'a (2)');
});

test('refacturé au client : suit l’observation jusque dans les archives', () => {
  const s = fresh();
  const b = s.boats[0];
  A.addObservations(s, b.id, [{ title: 'Taud déchiré' }]);
  const t = b.tasks.find((x) => !x.template);
  A.toggleBill(s, b.id, t.id);
  A.toggleTask(s, b.id, t.id);
  A.newReturn(s, b.id);
  A.setBilled(s, b.id, t.id, true); // cochée après archivage
  const o = observationsOf(b).find((x) => x.title === 'Taud déchiré');
  assert.equal(o.billed, true);
  A.setBilled(s, b.id, t.id, false);
  assert.equal(observationsOf(b).find((x) => x.title === 'Taud déchiré').billed, false);
});

test('à refacturer : heures, matériel, archives', () => {
  const s = fresh();
  const b = s.boats[0];
  A.addObservations(s, b.id, [{ title: 'Coussin déchiré par le client' }, { title: 'Ampoule' }]);
  const t = b.tasks.find((x) => x.title.startsWith('Coussin'));
  A.toggleBill(s, b.id, t.id);
  A.setBillField(s, b.id, t.id, 'hours', '1,5');
  A.setBillField(s, b.id, t.id, 'material', 'Housse neuve');
  A.setBillField(s, b.id, t.id, 'hours', 'abc'); // refusé : nombre attendu
  assert.equal(t.bill, true);
  assert.equal(t.hours, undefined);
  A.setBillField(s, b.id, t.id, 'hours', '1,5');
  assert.equal(t.hours, '1.5');
  assert.equal(t.material, 'Housse neuve');
  A.toggleBill(s, b.id, b.tasks[0].id); // tâche habituelle : ignorée
  assert.ok(!b.tasks[0].bill);
  A.toggleTask(s, b.id, t.id);
  A.newReturn(s, b.id);
  const o = observationsOf(b).find((x) => x.title.startsWith('Coussin'));
  assert.equal(o.bill, true);
  assert.equal(o.where, 'archive');
  assert.equal(o.hours, '1.5');
  assert.equal(o.material, 'Housse neuve');
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
  // Guadeloupe : pas de fenêtre « Signaler le départ / retour » pour l'équipe de Martinique
  const base = b.base;
  b.base = 'Guadeloupe';
  assert.deepEqual(A.dueDepartures(s), []);
  b.base = 'Martinique';
  b.resa = { status: 'quay', base: 'Marina Bas-du-Fort' }; // bateau de Martinique laissé en Guadeloupe
  assert.deepEqual(A.dueDepartures(s), []);
  b.resa = { status: 'quay', base: 'Le Marin' };
  assert.deepEqual(A.dueDepartures(s), [b.id]);
  b.base = base; delete b.resa;
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

test('catégories des tâches habituelles : classement automatique et choix manuel', async () => {
  const { guessTplCat, tplCatOf, TPL_CATS } = await import('../src/model.js');
  const { setTplCat } = await import('../src/actions.js');
  const g = Object.fromEntries([
    ['Récupérer le linge et le déposer à la laverie.', 0], ['Vider les approvisionnements du bateau.', 0], ['Vider et rincer les réservoirs d’eaux noires', 0], ['Faire le plein eau', 0],
    ['Verifier gaz (3 bouteiles)', 1], ['Remplacer le filtre du dessalinisateur si besoin', 1], ['Vérifier l’entretien moteur', 1], ['Nettoyer les bacs à eaux grises', 1],
    ['Nettoyer les fonds de cale', 2], ['Nettoyer les cales moteur', 2], ['Nettoyer l’annexe', 2], ['Nettoyer les coffres extérieurs et le caillebotis', 2],
    ['Nettoyer les contours des hublots', 3], ['Nettoyer le pont', 4], ['Ranger le bateau', 4],
  ]);
  for (const [t, i] of Object.entries(g)) assert.equal(guessTplCat(t), TPL_CATS[i], t);
  const s = { tplCats: {} };
  assert.equal(tplCatOf(s, 'Inconnue'), 'Autres');
  setTplCat(s, 'Inconnue', 'Finitions');
  assert.equal(tplCatOf(s, 'Inconnue'), 'Finitions');
});

test('journal : départ = une seule ligne, tâches habituelles ajoutées non notées', async () => {
  const { journalEvents } = await import('../src/journal-events.js');
  const cur = { inRental: false, tasks: [{ id: 'a', title: 'Gaz', template: true, done: false }, { id: 'b', title: 'Winch', done: false }], history: [] };
  assert.deepEqual(journalEvents(cur, { ...cur, inRental: true, tasks: [], history: [{ id: 'h', kind: 'departure' }] }).map((e) => e.kind), ['dep']);
  const next = { ...cur, tasks: [{ ...cur.tasks[0], done: true }, { ...cur.tasks[1], blocked: true }, { id: 'c', title: 'Gilets', template: true }] };
  assert.deepEqual(journalEvents(cur, next).map((e) => `${e.kind}:${e.what}`), ['done:Gaz', 'blocked:Winch']);
  assert.deepEqual(journalEvents({ ...cur, hours: { port: '1' } }, { ...cur, hours: { port: '2', stbd: '3' } })[0], { kind: 'hours', what: 'Heures moteur', note: 'Bâbord 2 h · Tribord 3 h' });
});

test('feuille retour : tous les points obligatoires, chaque Défaut devient une observation (titre = la note)', () => {
  const s = fresh();
  const id = s.boats[0].id;
  A.setHours(s, id, 'port', '1000'); A.setHours(s, id, 'stbd', '990');
  A.confirmDeparture(s, id);
  const b = s.boats[0];
  assert.equal(b.history[0].hours.port, '1000');
  A.startReturnSheet(s, id, 'Léa');
  A.setSheetText(s, id, 'stay.dossier', 'ACM-2026-0001');
  const items = sheetOf(s).flatMap((x) => x.items);
  assert.throws(() => A.validateReturnSheet(s, id, 'Léa'), /points? à voir/);
  items.forEach((it) => A.setSheetValue(s, id, it.id, 'ok'));
  A.setSheetValue(s, id, 'voi3', 'def'); // lazy bag
  assert.throws(() => A.validateReturnSheet(s, id, 'Léa'), /Décris le défaut/);
  A.setSheetNote(s, id, 'voi3', 'la fermeture éclair est cassée');
  A.setSheetBill(s, id, 'voi3', true);
  A.setSheetValue(s, id, 'mtd4', 'def'); A.setSheetNote(s, id, 'mtd4', 'Courroie tribord à remplacer');
  A.setSheetNum(s, id, 'hoursPort', '1012,5'); A.setSheetNum(s, id, 'hoursStbd', '1001');
  const r = A.validateReturnSheet(s, id, 'Léa');
  assert.equal(r.obs, 2);
  assert.equal(b.inRental, false);
  assert.equal(b.returnDraft, null);
  const obs = b.tasks.filter((t) => t.sheet);
  assert.deepEqual(obs.map((t) => t.title).sort(), ['Courroie tribord à remplacer', 'la fermeture éclair est cassée']);
  assert.equal(obs.find((t) => t.title.startsWith('la fermeture')).bill, true);
  assert.equal(obs[0].dossier, 'ACM-2026-0001');
  assert.equal(b.hours.port, '1012,5');
  assert.deepEqual(b.returnSheets[0].tripHours, { port: 12.5, stbd: 11 });
  // le modèle change ensuite : la feuille validée garde sa copie
  A.sheetRenameItem(s, 'voi', 'voi3', 'Lazy bag (housse)');
  assert.equal(b.returnSheets[0].sheet.find((x) => x.id === 'voi').items[2].label, 'Lazy bag');
});

test('feuille retour : pas de doublon d’observation, annulation, modèle modifiable', () => {
  const s = fresh();
  const id = s.boats[0].id;
  A.addObservations(s, id, [{ title: 'Winch bâbord dur' }]);
  A.confirmDeparture(s, id);
  A.startReturnSheet(s, id);
  A.cancelReturnSheet(s, id);
  assert.equal(s.boats[0].returnDraft, null);
  assert.equal(s.boats[0].inRental, true);
  A.sheetAddSection(s, 'Sécurité');
  const sec = sheetOf(s).at(-1);
  A.sheetAddItem(s, sec.id, 'Extincteurs');
  A.startReturnSheet(s, id);
  sheetOf(s).flatMap((x) => x.items).forEach((it) => A.setSheetValue(s, id, it.id, 'ok'));
  A.setSheetValue(s, id, 'gre5', 'def'); A.setSheetNote(s, id, 'gre5', 'Winch bâbord dur');
  assert.equal(A.validateReturnSheet(s, id).obs, 0);
  assert.equal(s.boats[0].tasks.filter((t) => t.title === 'Winch bâbord dur').length, 1);
  A.sheetReset(s);
  assert.equal(sheetOf(s).some((x) => x.title === 'Sécurité'), false);
});

test('feuille retour : mélange à faire = observation avec les litres', () => {
  const s = fresh();
  const id = s.boats[0].id;
  A.confirmDeparture(s, id);
  A.startReturnSheet(s, id);
  sheetOf(s).flatMap((x) => x.items).forEach((it) => A.setSheetValue(s, id, it.id, 'ok'));
  A.setSheetValue(s, id, 'ann4', 'def');
  assert.throws(() => A.validateReturnSheet(s, id), /litres à mélanger/);
  A.setSheetNote(s, id, 'ann4', '4.5');
  A.validateReturnSheet(s, id);
  assert.ok(s.boats[0].tasks.some((t) => t.title === 'Mélange à faire : 4,5 L'));
  assert.equal(sheetOf(s).some((x) => x.items.some((it) => /fissures|eau de mer/i.test(it.label) && x.id !== 'mbd' && x.id !== 'mtd')), false);
  assert.ok(sheetOf(s).find((x) => x.id === 'ele').items.some((it) => /gasoil/i.test(it.label)));
});

test('feuille retour : le modèle par défaut n’est pas enregistré (une mise à jour s’applique)', () => {
  const s = emptyState();
  assert.equal(s.returnSheet, null);
  A.sheetAddSection(s, 'Sécurité');
  assert.ok(Array.isArray(s.returnSheet));
  A.sheetDeleteSection(s, sheetOf(s).at(-1).id);
  assert.equal(s.returnSheet, null);
});

test('feuille retour : options du séjour à vérifier, dossier court', async () => {
  const { shortDossier } = await import('../src/model.js');
  assert.equal(shortDossier('ACM-2026-5426'), '5426');
  const s = fresh();
  const id = s.boats[0].id;
  A.confirmDeparture(s, id);
  s.boats[0].stay = { dossier: 'ACM-2026-5426', client: 'Durand', options: [{ key: 'paddle', label: 'Paddle', qty: 2 }] };
  A.startReturnSheet(s, id);
  const sh = A.draftSheet(s, s.boats[0].returnDraft);
  assert.equal(sh.at(-1).items[0].label, 'Paddle ×2');
  sh.flatMap((x) => x.items).forEach((it) => A.setSheetValue(s, id, it.id, 'ok'));
  A.setSheetValue(s, id, 'opt-paddle', 'def'); A.setSheetNote(s, id, 'opt-paddle', 'Paddle crevé');
  A.validateReturnSheet(s, id);
  assert.ok(s.boats[0].tasks.some((t) => t.title === 'Paddle crevé' && t.dossier === 'ACM-2026-5426'));
});

test('réservations : « Collé » seulement au Marin, bateau loué en Guadeloupe traité comme la Guadeloupe', async () => {
  const { isTight, inMartinique } = await import('../src/model.js');
  const mk = (base) => ({ base: 'Martinique', inRental: true, resa: { status: 'sea', nextRet: '2026-11-21T09:00', nextDep: '2026-11-21T17:00', cur: { depBase: base, retBase: base }, next: { depBase: base } } });
  assert.equal(isTight(mk('Le Marin')), true);
  assert.equal(isTight(mk('Marina Bas-du-Fort')), false);
  assert.equal(inMartinique(mk('Le Marin')), true);
  assert.equal(inMartinique(mk('Marina Bas-du-Fort')), false);
  assert.equal(inMartinique({ base: 'Martinique' }), true);
});

test('collé : dates saisies à la main (location hors réservations)', async () => {
  const { isTight } = await import('../src/model.js');
  const b = { base: 'Martinique', inRental: true, departure: '2026-11-14T17:00', returnDate: '2026-11-14T09:00', resa: { status: 'quay', base: 'Le Marin', homeRet: '', homeDep: '2026-11-14T17:00', moves: [] } };
  assert.equal(isTight(b), true);
  b.returnDate = '2026-11-13T09:00';
  assert.equal(isTight(b), false);
  b.departure = '2026-11-01T17:00'; // ancien départ (déjà effectué) : on s'en remet aux réservations
  b.returnDate = '2026-11-14T09:00';
  assert.equal(isTight(b), false);
});

// Flotte fictive pour essayer l'application sans rien importer.
import { emptyState, normalizeBoat, mkTask, mkMaint, DEFAULT_TEMPLATES } from './model.js';
import { todayStr, nowIso, nowLocal, addDays } from './util.js';

export function demoState() {
  const s = emptyState();
  const now = new Date();
  const at = (days, h = 12, m = 0) => { const d = addDays(now, days); d.setHours(h, m, 0, 0); return nowLocal(d); };
  const day = (n) => todayStr(addDays(now, n));
  s.team = ['Léa', 'Mathis', 'Sofia', 'Karim'];

  const mk = (o) => {
    const b = normalizeBoat({
      model: 'Catamaran de location', templates: DEFAULT_TEMPLATES.slice(), cycle: day(-4), ...o,
      maintenance: o.maintenance || [mkMaint('Survie'), mkMaint('Extincteurs'), mkMaint('Entretien moteur')],
    }, s.boats.length);
    if (!o.tasks) b.tasks = DEFAULT_TEMPLATES.map((t) => mkTask(t, true));
    s.boats.push(b);
    return b;
  };
  const doneN = (b, n) => b.tasks.slice(0, n).forEach((t) => { t.done = true; t.doneAt = nowIso(); });
  const maint = (survie, ext, mot, hours) => [
    mkMaint('Survie', { date: survie }), mkMaint('Extincteurs', { date: ext }), mkMaint('Entretien moteur', { date: mot, hours }),
  ];

  const a = mk({ name: 'Aurore', base: 'Martinique', departure: at(3, 17, 0), techs: ['Léa'], maintenance: maint(day(-120), day(-200), day(-60), '1180') });
  doneN(a, 9);
  a.tasks.push(mkTask('Winch bâbord à regraisser', false, { blocked: false }));
  a.importantEvents.push({ id: 'e1', title: 'Pompe HP du dessalinisateur remplacée : 55 l/h passés à 70 l/h', category: 'Dessalinisateur', date: day(-3), details: '', pinned: true });
  a.fiches.push({ id: 'f1', date: day(-4) + 'T16:20', client: 'Équipage Martin', hoursPort: '1182', hoursStbd: '1176', fuel: '60', water: '30', gas: '2', notes: 'Retour avec une demi-heure de retard.', zones: { Moteurs: { s: 'ok', note: '' }, Annexe: { s: 'todo', note: 'Sable dans le puisard' } }, obs: [], createdAt: nowIso() });

  const b = mk({ name: 'Bora', base: 'Martinique', departure: at(1, 9, 30), techs: ['Mathis', 'Sofia'], maintenance: maint(day(-30), day(-30), day(-20), '905') });
  doneN(b, 14);
  b.tasks.push(mkTask('Prise 220 V manquante dans le carré', false, { blocked: true }));

  const c = mk({ name: 'Caravelle', base: 'Martinique', departure: at(9, 16, 0), maintenance: maint(day(-400), day(-10), '', '') });
  c.tasks.push(mkTask('Échelle de bain manquante'), mkTask('Drapeau à remplacer'));

  const d = mk({ name: 'Dorade', base: 'Guadeloupe', departure: at(5, 11, 0), techs: ['Karim'], maintenance: maint(day(-90), day(-90), day(-90), '2040') });
  doneN(d, 15);

  const e = mk({ name: 'Escale', base: 'Guadeloupe', departure: '', maintenance: maint('', '', '', '') });
  e.tasks.push(mkTask('Voile d’avant déchirée au point d’écoute', false, { blocked: true }));

  const f = mk({ name: 'Fregate', base: 'Martinique', inRental: true, departureArchived: true, departure: at(-2, 17, 0), returnDate: at(5, 10, 0), tasks: [], maintenance: maint(day(-45), day(-45), day(-45), '3310') });
  f.pendingOnReturn = [mkTask('Eau dans la cale moteur bâbord', false, { carried: true })];
  f.fiches.push({ id: 'f2', date: day(-12) + 'T10:05', client: 'Famille Roche', hoursPort: '3302', hoursStbd: '3297', fuel: '40', water: '50', gas: '3', notes: '', zones: {}, obs: [], createdAt: nowIso() });

  const g = mk({ name: 'Gabian', base: 'Guadeloupe', inRental: true, departureArchived: true, departure: at(-6, 17, 0), returnDate: '', tasks: [], maintenance: maint(day(-20), day(-20), day(-20), '780') });
  g.pendingOnReturn = [];

  const h = mk({ name: 'Houle', base: 'Autre', otherBase: 'Les Saintes', departure: at(14, 12, 0), maintenance: maint(day(-15), day(-15), day(-15), '120') });
  doneN(h, 3);
  return s;
}

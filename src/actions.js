// Toutes les modifications de données. Chaque fonction reçoit l'état « brouillon » (muté en place)
// via store.mutate(), qui s'occupe de l'enregistrement et de l'annulation.
import { uid, todayStr, nowIso, clone, norm } from './util.js';
import { mkTask, mkMaint, normalizeBoat, newBoat, tplsOf, DEFAULT_TEMPLATES } from './model.js';

const find = (s, id) => {
  const b = s.boats.find((x) => x.id === id);
  if (!b) throw new Error('Bateau introuvable');
  return b;
};
export function log(b, text) {
  b.logs = [{ date: nowIso(), text }, ...b.logs].slice(0, 200);
}

// ---- tâches ----------------------------------------------------------------
export function toggleTask(s, id, tid) {
  const b = find(s, id), t = b.tasks.find((x) => x.id === tid);
  if (!t) return;
  if (t.done) { t.done = false; delete t.doneAt; log(b, `Rouverte : ${t.title}`); }
  else { t.done = true; t.doneAt = nowIso(); log(b, `Terminée : ${t.title}`); }
}
export function toggleBlock(s, id, tid) {
  const b = find(s, id), t = b.tasks.find((x) => x.id === tid);
  if (!t) return;
  t.blocked = !t.blocked;
  log(b, `${t.blocked ? 'Marquée bloquante' : 'Blocage retiré'} : ${t.title}`);
}
/** « À refacturer » au propriétaire : une observation, jamais une tâche habituelle. */
export function toggleBill(s, id, tid) {
  const b = find(s, id), t = b.tasks.find((x) => x.id === tid);
  if (!t || t.template) return;
  t.bill = !t.bill;
  if (!t.bill) { delete t.hours; delete t.material; }
  log(b, `${t.bill ? 'À refacturer' : 'Plus à refacturer'} : ${t.title}`);
}
/** Détail de la refacturation : heures passées (nombre) et matériel utilisé (texte libre). */
export function setBillField(s, id, tid, field, value) {
  const b = find(s, id), t = b.tasks.find((x) => x.id === tid);
  if (!t || !['hours', 'material'].includes(field)) return;
  let v = String(value || '').trim();
  if (field === 'hours') { v = v.replace(',', '.'); if (!Number.isFinite(Number(v)) || Number(v) < 0) v = ''; }
  if (v) t[field] = v; else delete t[field];
}
export function deleteTask(s, id, tid) {
  const b = find(s, id), t = b.tasks.find((x) => x.id === tid);
  if (!t) return;
  b.tasks = b.tasks.filter((x) => x.id !== tid);
  log(b, `Tâche retirée : ${t.title}`);
}
export function deletePending(s, id, tid) {
  const b = find(s, id), t = b.pendingOnReturn.find((x) => x.id === tid);
  if (!t) return;
  b.pendingOnReturn = b.pendingOnReturn.filter((x) => x.id !== tid);
  log(b, `Retirée de la liste du retour : ${t.title}`);
}
export function renameTask(s, id, tid, title) {
  const b = find(s, id), t = b.tasks.find((x) => x.id === tid);
  if (!t || !title.trim()) return;
  log(b, `Renommée : ${t.title} → ${title.trim()}`);
  t.title = title.trim();
}
/** Pendant une location, les observations vont dans « à reprendre au retour » (sinon elles seraient perdues). */
export function addObservations(s, id, items) {
  const b = find(s, id);
  const target = b.inRental ? b.pendingOnReturn : b.tasks;
  const have = new Set(target.filter((t) => !t.done).map((t) => t.title.toLowerCase()));
  const fresh = items.filter((i) => !have.has(i.title.toLowerCase()));
  fresh.forEach((i) => target.push(mkTask(i.title, false, { blocked: !!i.blocked, ...(b.inRental ? { carried: true } : {}) })));
  if (fresh.length) log(b, fresh.length === 1 ? `Observation ajoutée : ${fresh[0].title}` : `${fresh.length} observations ajoutées`);
  return fresh.length;
}

// ---- liste récurrente d'un bateau -------------------------------------------
export function setBoatTemplates(s, id, list) {
  find(s, id).templates = list;
}
export function addBoatTemplate(s, id, title, alsoNow) {
  const b = find(s, id);
  const list = tplsOf(s, b).slice();
  if (list.includes(title)) return false;
  list.push(title);
  b.templates = list;
  if (alsoNow && !b.inRental) b.tasks.push(mkTask(title, true));
  log(b, `Tâche récurrente ajoutée : ${title}`);
  return true;
}
export function removeBoatTemplate(s, id, i) {
  const b = find(s, id);
  const list = tplsOf(s, b).slice();
  const [x] = list.splice(i, 1);
  b.templates = list;
  if (x) log(b, `Tâche récurrente retirée : ${x}`);
}
export function moveBoatTemplate(s, id, i, dir) {
  const b = find(s, id);
  const list = tplsOf(s, b).slice(), j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  b.templates = list;
}
export function addMissingTemplates(s, id) {
  const b = find(s, id);
  const have = new Set(b.tasks.map((t) => t.template || t.title));
  const add = tplsOf(s, b).filter((t) => !have.has(t));
  add.forEach((t) => b.tasks.push(mkTask(t, true)));
  if (add.length) log(b, `Tâches récurrentes ajoutées (${add.length})`);
  return add.length;
}
export function resetBoatTemplates(s, id) {
  const b = find(s, id);
  b.templates = s.templates.slice();
  log(b, 'Liste récurrente remise à la liste de la flotte');
}

// ---- départ / retour --------------------------------------------------------
export function setDeparture(s, id, value) {
  const b = find(s, id);
  b.departure = value || '';
  log(b, value ? `Départ prévu modifié` : 'Départ prévu effacé');
}
export function setReturnDate(s, id, value) {
  const b = find(s, id);
  b.returnDate = value || '';
  log(b, value ? 'Retour prévu modifié' : 'Retour prévu effacé');
}
export function confirmDeparture(s, id, { auto = false } = {}) {
  const b = find(s, id);
  const entry = {
    id: uid(), date: b.cycle || todayStr(), tasks: clone(b.tasks), kind: 'departure',
    at: nowIso(), automatic: !!auto, departure: b.departure || '',
  };
  b.history = [entry, ...b.history];
  b.pendingOnReturn = clone(b.tasks.filter((t) => !t.done)).map((t) => ({ ...t, carried: true }));
  b.tasks = [];
  b.departureArchived = true;
  b.inRental = true;
  b.lastDeparture = b.departure || '';
  log(b, auto
    ? 'Départ automatique : préparation archivée, tâches non terminées reportées au retour'
    : 'Départ signalé : préparation archivée, observations non terminées reportées au retour');
}
/** Ce que « Nouveau retour » va faire, pour l'afficher avant de valider. */
export function returnPlan(s, b) {
  const obs = (list) => list.filter((t) => !t.template && t.title);
  const seen = new Set();
  const kept = obs([...b.pendingOnReturn, ...b.tasks]).filter((t) => !t.done)
    .filter((t) => { const k = norm(t.title); if (seen.has(k)) return false; seen.add(k); return true; });
  return {
    archived: b.tasks.length,
    obsDone: obs(b.tasks).filter((t) => t.done).length,
    kept,
    templates: tplsOf(s, b).length,
  };
}
/**
 * Nouveau retour : la préparation en cours part dans les archives, les observations non terminées
 * (y compris celles notées pendant la location) restent dans la préparation, les tâches habituelles repartent à zéro.
 */
export function newReturn(s, id, now = new Date()) {
  const b = find(s, id);
  const plan = returnPlan(s, b);
  if (b.tasks.length) {
    b.history = [{ id: uid(), date: b.cycle || todayStr(now), tasks: clone(b.tasks), kind: 'return', at: nowIso() }, ...b.history];
  }
  b.tasks = [...tplsOf(s, b).map((t) => mkTask(t, true)), ...plan.kept.map((t) => ({ ...clone(t), carried: true }))];
  b.pendingOnReturn = [];
  b.inRental = false;
  b.departureArchived = false;
  if (!b.departure || new Date(b.departure) <= now) b.departure = '';
  b.returnDate = '';
  b.cycle = todayStr(now);
  log(b, `Nouveau retour : préparation archivée${plan.kept.length ? `, ${plan.kept.length} observation${plan.kept.length > 1 ? 's' : ''} non terminée${plan.kept.length > 1 ? 's' : ''} gardée${plan.kept.length > 1 ? 's' : ''}` : ''}`);
  return plan;
}
/** Ancien nom, gardé pour compatibilité. */
export const returnToBase = (s, id) => newReturn(s, id);
/** Départs dont l'heure est passée et qui n'ont pas encore été signalés. */
export function dueDepartures(s, now = new Date()) {
  if (!s.prefs?.autoDeparture) return [];
  return s.boats.filter((b) => !b.inRental && !b.departureArchived && b.departure && new Date(b.departure) <= now).map((b) => b.id);
}

// ---- relevé moteur ------------------------------------------------------------------
export function setHours(s, id, field, value) {
  const b = find(s, id);
  b.hours = { ...(b.hours || {}), [field]: String(value || '').trim(), date: nowIso() };
  log(b, `Relevé moteur ${field === 'port' ? 'bâbord' : 'tribord'} : ${value || '—'} h`);
}

// ---- entretiens et événements --------------------------------------------------
export function updateMaint(s, id, mid, field, value) {
  const b = find(s, id), m = b.maintenance.find((x) => x.id === mid);
  if (!m) return;
  m[field] = ['intervalDays', 'intervalHours'].includes(field) ? (Number(value) || undefined) : value;
  log(b, `Entretien mis à jour : ${m.title}`);
}
export function addMaint(s, id, title) {
  const b = find(s, id);
  b.maintenance.push(mkMaint(title));
  log(b, `Entretien ajouté : ${title}`);
}
export function deleteMaint(s, id, mid) {
  const b = find(s, id), m = b.maintenance.find((x) => x.id === mid);
  b.maintenance = b.maintenance.filter((x) => x.id !== mid);
  if (m) log(b, `Entretien retiré : ${m.title}`);
}
export function addEvent(s, id, e) {
  const b = find(s, id);
  b.importantEvents.push({ id: uid(), pinned: false, details: '', category: 'Autre', date: todayStr(), ...e });
  log(b, `Événement important : ${e.title}`);
}
export function toggleEventPin(s, id, eid) {
  const e = find(s, id).importantEvents.find((x) => x.id === eid);
  if (e) e.pinned = !e.pinned;
}
export function deleteEvent(s, id, eid) {
  const b = find(s, id);
  b.importantEvents = b.importantEvents.filter((x) => x.id !== eid);
}

// ---- bateau, équipe, flotte ------------------------------------------------------
export function updateBoat(s, id, patch) {
  const b = find(s, id);
  const before = b.name;
  Object.assign(b, patch);
  if (patch.name && patch.name !== before) log(b, `Bateau renommé : ${before} → ${patch.name}`);
}
export function setTechs(s, id, names) {
  const b = find(s, id);
  b.techs = names;
  log(b, names.length ? `Techniciens : ${names.join(', ')}` : 'Aucun technicien affecté');
}
export function addBoat(s, data) {
  const order = s.boats.reduce((m, b) => Math.max(m, b.order + 1), 0);
  const b = newBoat(data, s.templates, order);
  s.boats.push(b);
  return b.id;
}
export function deleteBoat(s, id) {
  s.boats = s.boats.filter((b) => b.id !== id);
}
export function addMember(s, name) {
  const n = name.trim();
  if (n && !s.team.some((x) => x.toLowerCase() === n.toLowerCase())) s.team.push(n);
}
export function removeMember(s, name) {
  s.team = s.team.filter((x) => x !== name);
  s.boats.forEach((b) => { b.techs = b.techs.filter((t) => t !== name); });
}
export function toggleAssign(s, name, id) {
  const b = find(s, id);
  b.techs = b.techs.includes(name) ? b.techs.filter((t) => t !== name) : [...b.techs, name];
}
export function setFleetTemplates(s, list) {
  s.templates = list;
}
export function applyTemplatesToFleet(s) {
  s.boats.forEach((b) => { b.templates = s.templates.slice(); });
}
export function addMissingToAll(s) {
  let n = 0;
  s.boats.forEach((b) => { if (!b.inRental) n += addMissingTemplates(s, b.id); });
  return n;
}
export function setPref(s, key, value) {
  s.prefs = { ...s.prefs, [key]: value };
}
export { normalizeBoat, DEFAULT_TEMPLATES };

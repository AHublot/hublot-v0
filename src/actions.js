// Toutes les modifications de données. Chaque fonction reçoit l'état « brouillon » (muté en place)
// via store.mutate(), qui s'occupe de l'enregistrement et de l'annulation.
import { uid, todayStr, nowIso, clone, norm, parseObservations } from './util.js';
import { mkTask, mkMaint, normalizeBoat, newBoat, tplsOf, DEFAULT_TEMPLATES, sheetOf, sheetItems, storedSheet, inMartinique, homeBase } from './model.js';

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
  if (!t.bill) { delete t.hours; delete t.material; delete t.billed; delete t.billedAt; }
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
/** « Refacturé au client » : appliqué à toutes les copies de l'observation (préparation, location, archives). */
export function setBilled(s, id, tid, on) {
  const b = find(s, id);
  let hit = null;
  const apply = (t) => {
    if (t.id !== tid) return;
    if (on) { t.billed = true; t.billedAt = t.billedAt || nowIso(); } else { delete t.billed; delete t.billedAt; }
    hit = t;
  };
  b.tasks.forEach(apply); b.pendingOnReturn.forEach(apply); b.history.forEach((h) => (h.tasks || []).forEach(apply));
  if (hit) log(b, `${on ? 'Refacturé au client' : 'Refacturation annulée'} : ${hit.title}`);
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
  // pendant une location, l'observation garde le numéro de dossier du séjour (export de refacturation)
  fresh.forEach((i) => target.push(mkTask(i.title, false, { blocked: !!i.blocked, ...(b.inRental ? { carried: true } : {}), ...(b.inRental && b.stay?.dossier ? { dossier: b.stay.dossier } : {}) })));
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
export function confirmDeparture(s, id, { auto = false, now = new Date() } = {}) {
  const b = find(s, id);
  // La location qui commence est dans les réservations : retour prévu et séjour tout de suite (sans attendre la synchro).
  const n = b.resa?.next;
  const startsNow = n?.dossier && n.dep && Math.abs(new Date(n.dep) - now) < 36 * 3600e3;
  const entry = {
    id: uid(), date: b.cycle || todayStr(), tasks: clone(b.tasks), kind: 'departure',
    at: nowIso(), automatic: !!auto, departure: b.departure || '',
    ...(b.hours && (b.hours.port || b.hours.stbd) ? { hours: { port: b.hours.port || '', stbd: b.hours.stbd || '', ...(b.hours.date ? { date: b.hours.date } : {}) } } : {}),
  };
  b.history = [entry, ...b.history];
  // Seules les observations non terminées passent au retour : les tâches habituelles repartent à zéro.
  // Les options client de la location qui part ne sont pas reportées : elles sont vérifiées au retour (feuille retour, « Options du séjour »).
  const leaving = startsNow ? n.dossier : '';
  b.pendingOnReturn = clone(b.tasks.filter((t) => !t.done && !t.template && !(t.opt && leaving && t.dossier === leaving))).map((t) => ({ ...t, carried: true }));
  b.tasks = [];
  b.departureArchived = true;
  b.inRental = true;
  b.lastDeparture = b.departure || '';
  if (startsNow) {
    if (!b.returnDate && n.ret) { b.returnDate = n.ret; b.resaDates = { ...(b.resaDates || {}), returnDate: n.ret }; }
    b.stay = { dossier: n.dossier, client: n.client || '', skipper: n.skipper && n.skipper !== 'à attribuer' ? n.skipper : '', dep: n.dep, ret: n.ret || '', options: homeBase({ base: 'Martinique' }, n.depBase || '') ? n.options || [] : [] };
  } else if (b.stay) b.stay = null; // reste d'une location précédente
  log(b, auto
    ? 'Départ automatique : préparation archivée, observations non terminées reportées au retour'
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
/** Retours prévus dont l'heure est passée, bateau toujours en location. */
export function dueReturns(s, now = new Date()) {
  if (!s.prefs?.autoDeparture) return [];
  return s.boats.filter((b) => inMartinique(b) && b.inRental && b.returnDate && new Date(b.returnDate) <= now).map((b) => b.id);
}
/** Départs dont l'heure est passée et qui n'ont pas encore été signalés. */
export function dueDepartures(s, now = new Date()) {
  if (!s.prefs?.autoDeparture) return [];
  // Seulement les bateaux en Martinique : l'équipe n'a pas à signaler les départs de Guadeloupe.
  return s.boats.filter((b) => inMartinique(b) && !b.inRental && !b.departureArchived && b.departure && new Date(b.departure) <= now).map((b) => b.id);
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
/**
 * Renomme une tâche de la liste de préparation partout : liste de la flotte, liste propre à chaque
 * bateau (utilisée au prochain retour) et tâches en cours. Les tâches gardent leur identifiant et
 * leurs réponses (cochée, par qui, bloquée, notes…) : seul l'intitulé change.
 */
export function renameTemplate(s, from, to) {
  to = String(to || '').trim();
  if (!to || to === from) return null;
  if (s.templates.includes(to)) throw new Error('cette tâche existe déjà dans la liste');
  s.templates = s.templates.map((t) => (t === from ? to : t));
  if (s.tplCats && from in s.tplCats) { const c = { ...s.tplCats }; c[to] = c[from]; delete c[from]; s.tplCats = c; }
  let prep = 0, next = 0;
  s.boats.forEach((b) => {
    if (b.templates?.includes(from)) { b.templates = b.templates.map((t) => (t === from ? to : t)); if (b.inRental) next++; }
    let hit = false;
    b.tasks.forEach((t) => { if (t.template === from) { t.template = to; t.title = to; hit = true; } });
    if (hit) { if (!b.inRental) prep++; log(b, `Tâche habituelle renommée : ${from} → ${to}`); }
  });
  return { prep, next };
}
export function setTplCat(s, title, cat) {
  if (!title) return;
  s.tplCats = { ...(s.tplCats || {}), [title]: cat };
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

// ---- feuille retour -------------------------------------------------------------------------
// 1 retour = 1 feuille. Le brouillon (`returnDraft`) est synchronisé : on peut reprendre plus tard.
// À la validation : retour signalé, chaque Défaut devient une observation (titre = la note, telle quelle).

/** Commence (ou reprend) la feuille retour d'un bateau en location. */
export function startReturnSheet(s, id, user = '') {
  const b = find(s, id);
  if (b.returnDraft) return b.returnDraft;
  const st = b.stay || {};
  b.returnDraft = {
    id: uid(), startedAt: nowIso(), startedBy: user || '',
    stay: { dossier: st.dossier || '', client: st.client || '', skipper: st.skipper || '', dep: st.dep || b.lastDeparture || '', ret: st.ret || b.returnDate || '', options: Array.isArray(st.options) ? st.options : [] },
    values: {}, notes: {}, bill: {}, nums: {}, clientObs: '',
  };
  log(b, 'Feuille retour commencée');
  return b.returnDraft;
}
const draftOf = (s, id) => { const b = find(s, id); if (!b.returnDraft) throw new Error('Aucune feuille retour en cours'); return [b, b.returnDraft]; };
/** OK ou Défaut sur un point ; même valeur une 2e fois = on retire la réponse. */
export function setSheetValue(s, id, itemId, value) {
  const [, d] = draftOf(s, id);
  const v = { ...d.values };
  // pas de bascule : retoucher le choix déjà fait ne l'efface pas (double appui, appui après un défilement)
  if (v[itemId] === value) return;
  v[itemId] = value;
  d.values = v;
}
export function setSheetNote(s, id, itemId, text) { const [, d] = draftOf(s, id); d.notes = { ...d.notes, [itemId]: String(text || '') }; }
export function setSheetBill(s, id, itemId, on) { const [, d] = draftOf(s, id); d.bill = { ...d.bill, [itemId]: !!on }; }
export function setSheetNum(s, id, key, value) { const [, d] = draftOf(s, id); d.nums = { ...d.nums, [key]: String(value || '').trim() }; }
/** Champs libres : clientObs, other, note, et le séjour (stay.dossier, stay.client, stay.skipper). */
export function setSheetText(s, id, field, value) {
  const [, d] = draftOf(s, id);
  const v = String(value || '');
  if (field.startsWith('stay.')) d.stay = { ...d.stay, [field.slice(5)]: v };
  else if (field === 'clientObs') d.clientObs = v;
  else if (field === 'billToday') d.billToday = v; // « Uniquement pour le bureau : à facturer aujourd'hui » (facultatif)
}
/** « Plongeur passé » (case facultative, pour le bureau). */
export function setSheetDiver(s, id, on) { const [, d] = draftOf(s, id); d.diver = !!on; }
export function cancelReturnSheet(s, id) {
  const b = find(s, id);
  b.returnDraft = null;
  log(b, 'Feuille retour annulée');
}
/** Titre de l'observation créée par un Défaut : la note telle quelle ; pour le mélange, les litres à faire. */
// Contexte d'une question de la feuille retour, devant la note du technicien dans l'observation.
const OBS_CTX_LABEL = {
  Drosses: 'Drosses de barre', 'Pompe eau': 'Pompe à eau', Fonds: 'Fonds de coque',
  'Le sondeur fonctionne-t-il ?': 'Sondeur', 'Le gasoil est-il plein ?': 'Gasoil pas plein',
};
const OBS_CTX_SEC = { mbd: 'Moteur bâbord – ', mtd: 'Moteur tribord – ', inv: 'Inventaire – ', des: 'Dessalinisateur – ' };
const DEFAULT_SECS = new Set(['mbd', 'mtd', 'bat', 'plo', 'cui', 'des', 'ele', 'coq', 'gre', 'voi', 'mou', 'ann', 'inv']);
/** « Moteur bâbord – Filtre eau de mer » ; point ajouté par un manager → « Partie – Point ». */
export function sheetObsContext(it) {
  const sec = it.sec || {};
  if (sec.id === 'opts') return `Option ${it.label}`;
  const label = OBS_CTX_LABEL[it.label] || it.label;
  if (OBS_CTX_SEC[sec.id]) return OBS_CTX_SEC[sec.id] + (sec.id === 'des' ? label.toLowerCase() : label);
  if (DEFAULT_SECS.has(sec.id) || !sec.title) return label;
  return `${sec.title} – ${label}`;
}
export function sheetObsTitle(it, note) {
  const n = String(note ?? '').trim();
  return it.kind === 'mix' ? `Mélange à faire : ${n.replace('.', ',')} L` : `${sheetObsContext(it)} : ${n}`;
}
/** « Observations du client et autre » (client et technicien) : une ligne (ou « ; ») = une observation à cocher, sans préfixe, comme « Ajouter mes observations ». « ! » devant = bloquante. */
export const clientObsList = (text) => parseObservations(text).map((o) => ({ title: o.title, raw: o.title, blocked: !!o.blocked }));
/** Feuille d'un brouillon : le modèle, plus les options du séjour (à vérifier au retour). */
export function draftSheet(s, d) {
  const sh = sheetOf(s);
  const o = Array.isArray(d?.stay?.options) ? d.stay.options : [];
  return o.length ? [...sh, { id: 'opts', title: 'Options du séjour', items: o.map((x) => ({ id: `opt-${x.key}`, label: `${x.label}${x.qty > 1 ? ` ×${x.qty}` : ''}` })) }] : sh;
}
/** Ce qui manque pour valider : points sans réponse, Défauts sans note. */
export function sheetMissing(s, b, d = b.returnDraft) {
  const items = sheetItems(draftSheet(s, d));
  return {
    unseen: items.filter((it) => !d?.values?.[it.id]),
    noNote: items.filter((it) => d?.values?.[it.id] === 'def' && !String(d?.notes?.[it.id] || '').trim()),
    total: items.length,
  };
}
const numOrNull = (v) => { const n = parseFloat(String(v ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
/**
 * Heures du séjour par moteur = relevé au retour − relevé au départ (null si on ne peut pas s'y fier).
 * Prudence, car beaucoup de bateaux n'ont pas encore de relevé à jour :
 * - le relevé du départ doit avoir été saisi depuis la location précédente (sinon il date d'avant et compterait 2 séjours) ;
 * - le résultat ne peut pas dépasser le temps écoulé depuis le départ (faute de frappe, compteur changé) ;
 * - un relevé au retour plus petit qu'au départ ne donne rien.
 */
export function tripHours(b, nums, now = new Date()) {
  const deps = (b.history || []).filter((h) => h.kind === 'departure');
  const dep = deps[0], prev = deps[1];
  const none = { port: null, stbd: null };
  if (!dep?.hours) return none;
  // Date du relevé : enregistrée au départ, sinon (anciens départs) celle du relevé actuel s'il n'a pas changé depuis.
  const same = b.hours && ['port', 'stbd'].every((k) => String(b.hours[k] || '') === String(dep.hours[k] || ''));
  const when = dep.hours.date || (same ? b.hours.date : '') || '';
  if (prev?.at && (!when || when < prev.at)) return none;
  const leftAt = new Date(dep.at || 0), max = Number.isNaN(+leftAt) || !dep.at ? Infinity : (now - leftAt) / 3600e3 + 1;
  const diff = (a0, c0) => {
    const a = numOrNull(a0), c = numOrNull(c0);
    if (a == null || c == null || a < c) return null;
    const d = Math.round((a - c) * 10) / 10;
    return d <= max ? d : null;
  };
  return { port: diff(nums.hoursPort, dep.hours.port), stbd: diff(nums.hoursStbd, dep.hours.stbd) };
}
/**
 * Valide la feuille : retour signalé (préparation archivée comme aujourd'hui), une observation par Défaut,
 * relevé moteur mis à jour, feuille rangée dans `returnSheets`. Refuse une feuille incomplète.
 */
export function validateReturnSheet(s, id, user = '', now = new Date()) {
  const b = find(s, id);
  const d = b.returnDraft;
  if (!d) throw new Error('Aucune feuille retour en cours');
  const miss = sheetMissing(s, b, d);
  if (miss.unseen.length) throw new Error(`Encore ${miss.unseen.length} point${miss.unseen.length > 1 ? 's' : ''} à voir`);
  if (miss.noNote.length) throw new Error(miss.noNote[0].kind === 'mix' ? 'Indique les litres à mélanger' : `Décris le défaut : ${miss.noNote[0].label}`);
  const sheet = draftSheet(s, d);
  const trip = tripHours(b, d.nums || {}, now);
  newReturn(s, id, now);
  const open = new Set(b.tasks.filter((t) => !t.done).map((t) => norm(t.title)));
  const obsIds = [];
  sheetItems(sheet).filter((it) => d.values[it.id] === 'def').forEach((it) => {
    const title = sheetObsTitle(it, d.notes[it.id]);
    // déjà noté (avec ou sans le contexte de la question) : pas de doublon
    if (open.has(norm(title)) || (it.kind !== 'mix' && open.has(norm(d.notes[it.id])))) return;
    open.add(norm(title));
    const t = mkTask(title, false, { sheet: d.id, ...(d.stay?.dossier ? { dossier: d.stay.dossier } : {}), ...(d.bill[it.id] ? { bill: true } : {}) });
    b.tasks.push(t);
    obsIds.push(t.id);
  });
  clientObsList(d.clientObs).forEach((o) => {
    if (open.has(norm(o.title)) || open.has(norm(o.raw))) return;
    open.add(norm(o.title));
    const t = mkTask(o.title, false, { blocked: o.blocked, sheet: d.id, ...(d.stay?.dossier ? { dossier: d.stay.dossier } : {}) });
    b.tasks.push(t);
    obsIds.push(t.id);
  });
  const nums = d.nums || {};
  if (nums.hoursPort || nums.hoursStbd) {
    b.hours = { ...(b.hours || {}), ...(nums.hoursPort ? { port: nums.hoursPort } : {}), ...(nums.hoursStbd ? { stbd: nums.hoursStbd } : {}), date: nowIso() };
  }
  b.returnSheets = [{ ...clone(d), at: nowIso(), by: user || '', sheet, tripHours: trip, obsIds }, ...(b.returnSheets || [])];
  b.returnDraft = null;
  b.stay = null;
  log(b, `Feuille retour validée${obsIds.length ? ` : ${obsIds.length} observation${obsIds.length > 1 ? 's' : ''} créée${obsIds.length > 1 ? 's' : ''}` : ', aucun défaut'}`);
  return { obs: obsIds.length };
}

// ---- modèle de feuille (managers) ---------------------------------------------------------------
const sheetEdit = (s, fn) => { const sh = sheetOf(s); fn(sh); s.returnSheet = storedSheet(sh); };
export function sheetAddSection(s, title) { sheetEdit(s, (sh) => sh.push({ id: uid(), title: String(title || '').trim() || 'Nouvelle partie', items: [] })); }
export function sheetRenameSection(s, secId, title) { sheetEdit(s, (sh) => { const x = sh.find((y) => y.id === secId); if (x && String(title).trim()) x.title = String(title).trim(); }); }
export function sheetDeleteSection(s, secId) { sheetEdit(s, (sh) => { const i = sh.findIndex((y) => y.id === secId); if (i >= 0) sh.splice(i, 1); }); }
export function sheetMoveSection(s, secId, dir) { sheetEdit(s, (sh) => { const i = sh.findIndex((y) => y.id === secId), j = i + dir; if (i >= 0 && j >= 0 && j < sh.length) [sh[i], sh[j]] = [sh[j], sh[i]]; }); }
export function sheetAddItem(s, secId, label) { const l = String(label || '').trim(); if (!l) return; sheetEdit(s, (sh) => { const x = sh.find((y) => y.id === secId); if (x) x.items.push({ id: uid(), label: l }); }); }
export function sheetRenameItem(s, secId, itemId, label) { sheetEdit(s, (sh) => { const it = sh.find((y) => y.id === secId)?.items.find((z) => z.id === itemId); if (it && String(label).trim()) it.label = String(label).trim(); }); }
export function sheetDeleteItem(s, secId, itemId) { sheetEdit(s, (sh) => { const x = sh.find((y) => y.id === secId); if (x) x.items = x.items.filter((z) => z.id !== itemId); }); }
export function sheetMoveItem(s, secId, itemId, dir) { sheetEdit(s, (sh) => { const x = sh.find((y) => y.id === secId); if (!x) return; const i = x.items.findIndex((z) => z.id === itemId), j = i + dir; if (i >= 0 && j >= 0 && j < x.items.length) [x.items[i], x.items[j]] = [x.items[j], x.items[i]]; }); }
export function sheetReset(s) { s.returnSheet = null; }

// Modèle de données, normalisation (import de l'ancienne sauvegarde) et calculs dérivés.
import { uid, todayStr, nowIso, parseLocal, addDays, num, arr, cap, norm } from './util.js';

export const SCHEMA = 2;

export const DEFAULT_TEMPLATES = [
  'Vider et rincer les réservoirs d’eaux noires',
  'Nettoyer les bacs à eaux grises',
  'Nettoyer les fonds de cale',
  'Nettoyer les cales moteur',
  'Vérifier l’entretien moteur',
  'Nettoyer l’annexe',
  'Nettoyer le pont',
  'Nettoyer les contours des hublots',
  'Ranger le bateau',
  'Nettoyer les coffres extérieurs et le caillebotis',
  'Remplacer le filtre du dessalinisateur si besoin',
  'Vérifier le gaz (3 bouteilles)',
  'Faire le plein d’eau',
  'Vider les approvisionnements du bateau',
  'Récupérer le linge et le déposer à la laverie',
];

export const BASES = ['Martinique', 'Guadeloupe', 'Autre'];
export const ZONES = [
  'Coque et pont', 'Gréement et voiles', 'Moteurs', 'Annexe',
  'Électricité', 'Eau et sanitaires', 'Intérieur et cabines', 'Sécurité',
];
export const CATEGORIES = [
  'Moteur', 'Dessalinisateur', 'Électricité', 'Plomberie',
  'Gréement et voiles', 'Sécurité', 'Coque et pont', 'Autre',
];
export const INTERVALS = [
  { v: 0, l: 'Sans échéance' }, { v: 90, l: '3 mois' }, { v: 180, l: '6 mois' }, { v: 365, l: '1 an' }, { v: 730, l: '2 ans' },
];

export function guessInterval(title = '') {
  const t = norm(title);
  if (/survie|extincteur/.test(t)) return { intervalDays: 365 };
  if (/moteur/.test(t)) return { intervalDays: 180, intervalHours: 200 };
  return {};
}
export const DEFAULT_MAINT = ['Survie', 'Extincteurs', 'Entretien moteur'];
export const mkMaint = (title, extra = {}) => ({ id: uid(), title, date: '', hours: '', notes: '', ...guessInterval(title), ...extra });
export const mkTask = (title, tpl = false, extra = {}) => ({
  id: uid(), title, done: false, blocked: false, origin: todayStr(), ...(tpl ? { template: title } : {}), ...extra,
});

export function emptyState() {
  return {
    schema: SCHEMA, baseName: 'Ma base', team: [], templates: DEFAULT_TEMPLATES.slice(), boats: [],
    prefs: { autoDeparture: true }, updatedAt: nowIso(),
  };
}

export function newBoat({ name, model = 'Catamaran de location', base = '', otherBase = '' }, templates, order = 0) {
  return normalizeBoat({
    id: uid(), name, model, base, otherBase, order,
    templates: templates.slice(),
    tasks: templates.map((t) => mkTask(t, true)),
    maintenance: DEFAULT_MAINT.map((t) => mkMaint(t)),
    cycle: todayStr(),
    logs: [{ date: nowIso(), text: 'Bateau ajouté' }],
  }, order);
}

export function normalizeBoat(raw, i = 0) {
  const r = raw || {};
  const b = {
    id: r.id || uid(), name: r.name || `Bateau ${i + 1}`, model: r.model || '',
    base: r.base || '', otherBase: r.otherBase || '',
    departure: r.departure || '', returnDate: r.returnDate || '', lastDeparture: r.lastDeparture || '',
    inRental: !!r.inRental, departureArchived: !!r.departureArchived,
    cycle: r.cycle || todayStr(), order: Number.isFinite(r.order) ? r.order : i,
    tasks: arr(r.tasks), pendingOnReturn: arr(r.pendingOnReturn), templates: arr(r.templates),
    maintenance: arr(r.maintenance), history: arr(r.history), logs: arr(r.logs),
    importantEvents: arr(r.importantEvents), fiches: arr(r.fiches), techs: arr(r.techs),
    hours: r.hours && typeof r.hours === 'object' ? r.hours : null,
  };
  const fixTask = (t) => ({ ...t, id: t.id || uid(), title: String(t.title || ''), done: !!t.done, blocked: !!t.blocked });
  b.tasks = b.tasks.map(fixTask);
  b.pendingOnReturn = b.pendingOnReturn.map(fixTask);
  b.maintenance = b.maintenance.map((m) => {
    const g = guessInterval(m.title);
    return {
      id: m.id || uid(), title: m.title || 'Entretien', date: m.date || '', hours: m.hours || '', notes: m.notes || '',
      intervalDays: m.intervalDays ?? g.intervalDays, intervalHours: m.intervalHours ?? g.intervalHours,
    };
  });
  return b;
}

/** Accepte l'état courant, ou une sauvegarde « cap-depart-backup » de l'ancienne application. */
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Fichier vide ou illisible');
  const d = raw.format === 'cap-depart-backup' && raw.data ? raw.data : raw;
  if (!Array.isArray(d.boats)) throw new Error('Aucun bateau dans ce fichier');
  const seen = new Set();
  const boats = d.boats.map(normalizeBoat).filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
  boats.sort((a, b) => a.order - b.order);
  const team = arr(d.team).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
  const first = boats.find((b) => b.templates.length);
  const templates = arr(d.templates).length ? d.templates.slice() : first ? first.templates.slice() : DEFAULT_TEMPLATES.slice();
  return {
    schema: SCHEMA, baseName: d.baseName || 'Ma base', team, templates, boats,
    prefs: { autoDeparture: true, ...(d.prefs || {}) }, updatedAt: nowIso(),
  };
}

// ---- dérivés ---------------------------------------------------------------
export const baseLabel = (b) => (b.base === 'Autre' ? b.otherBase || 'Autre' : b.base || 'Sans base');
export const tplsOf = (s, b) => (b.templates?.length ? b.templates : s.templates);

export function boatStats(b) {
  const t = b.tasks;
  const rec = t.filter((x) => x.template);
  const obs = t.filter((x) => !x.template);
  const done = t.filter((x) => x.done).length;
  return {
    total: t.length, done, open: t.length - done, pct: t.length ? Math.round((100 * done) / t.length) : 0,
    blocked: t.filter((x) => x.blocked && !x.done).length,
    recTotal: rec.length, recOpen: rec.filter((x) => !x.done).length,
    obsTotal: obs.length, obsOpen: obs.filter((x) => !x.done).length,
  };
}

export function boatStatus(b) {
  if (b.inRental) return { key: 'rental', label: 'En location' };
  const st = boatStats(b);
  if (st.blocked) return { key: 'blocked', label: 'Bloqué' };
  if (st.total && !st.open) return { key: 'ready', label: 'Prêt' };
  return { key: 'prep', label: 'En préparation' };
}

export function latestHours(b) {
  const cands = [];
  if (b.hours) cands.push({ port: num(b.hours.port), stbd: num(b.hours.stbd), date: b.hours.date || '' });
  arr(b.fiches).forEach((f) => cands.push({ port: num(f.hoursPort), stbd: num(f.hoursStbd), date: f.date || '' }));
  const ok = cands.filter((c) => c.port != null || c.stbd != null).sort((x, y) => String(y.date).localeCompare(String(x.date)));
  if (!ok.length) return null;
  const c = ok[0];
  return { ...c, max: Math.max(c.port ?? -1, c.stbd ?? -1) };
}

// ---- observations ------------------------------------------------------------
const obsKey = (t) => norm(t.title) + '|' + (t.origin || '');
const isoDay = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? todayStr(d) : ''; };
/** Date utilisée pour trier et filtrer : jour du règlement, sinon jour du constat. */
export const obsDate = (o) => (o.done ? isoDay(o.doneAt) || o.origin : o.origin) || '';

/**
 * Toutes les observations d'un bateau (préparations archivées, points en attente pendant la location,
 * préparation en cours), sans doublon : la version la plus récente d'une même observation l'emporte.
 */
export function observationsOf(b) {
  const map = new Map();
  const put = (t, where, at = '') => {
    if (!t || t.template || !t.title) return;
    map.set(obsKey(t), {
      id: t.id, title: t.title, origin: t.origin || '', done: !!t.done, doneAt: t.doneAt || '',
      blocked: !!t.blocked, where, archivedAt: at,
    });
  };
  [...arr(b.history)].reverse().forEach((h) => arr(h.tasks).forEach((t) => put(t, 'archive', h.at || h.date || '')));
  arr(b.pendingOnReturn).forEach((t) => put(t, 'pending'));
  arr(b.tasks).forEach((t) => put(t, 'current'));
  return [...map.values()].sort((x, y) => obsDate(y).localeCompare(obsDate(x)));
}
/** Libellé de statut d'une observation. */
export function obsState(o) {
  if (o.done) return { key: 'done', label: 'Réglée' };
  if (o.where === 'archive') return { key: 'lost', label: 'Non réglée' };
  if (o.where === 'pending') return { key: 'open', label: 'Au retour' };
  return { key: 'open', label: 'À traiter' };
}

export function maintStatus(m, b, now = new Date()) {
  if (!m.date) return { key: 'missing', label: 'Date à renseigner' };
  let key = 'ok';
  const parts = [];
  const d = parseLocal(m.date);
  if (m.intervalDays && d) {
    const left = Math.round((addDays(d, m.intervalDays) - now) / 864e5);
    if (left < 0) { key = 'late'; parts.push(`en retard de ${-left} j`); }
    else { if (left <= 30) key = 'soon'; parts.push(`dans ${left} j`); }
  }
  const lh = latestHours(b), mh = num(m.hours);
  if (m.intervalHours && lh && mh != null) {
    const left = m.intervalHours - (lh.max - mh);
    if (left < 0) { key = 'late'; parts.push(`${Math.round(-left)} h de retard`); }
    else { if (left <= 20 && key !== 'late') key = 'soon'; parts.push(`encore ${Math.round(left)} h`); }
  }
  return { key, label: parts.length ? cap(parts.join(' · ')) : 'À jour' };
}

export const maintCounts = (b, now = new Date()) => {
  let late = 0, missing = 0, soon = 0;
  b.maintenance.forEach((m) => {
    const k = maintStatus(m, b, now).key;
    if (k === 'late') late++; else if (k === 'missing') missing++; else if (k === 'soon') soon++;
  });
  return { late, missing, soon };
};
export const missingDates = (b, now) => maintCounts(b, now).missing + (!b.inRental && !b.departure ? 1 : 0);

export const FILTERS = [
  { key: 'all', label: 'Tous les bateaux' },
  { key: 'rental', label: 'En location' },
  { key: 'blocked', label: 'Bloqués' },
  { key: 'late', label: 'Entretien en retard' },
  { key: 'missing', label: 'Dates manquantes' },
  { key: 'ready', label: 'Listes terminées' },
];
export function matchFilter(b, key, now = new Date()) {
  switch (key) {
    case 'rental': return b.inRental;
    case 'blocked': return !b.inRental && boatStats(b).blocked > 0;
    case 'late': return maintCounts(b, now).late > 0;
    case 'missing': return missingDates(b, now) > 0;
    case 'ready': return boatStatus(b).key === 'ready';
    case 'obs': return !b.inRental && boatStats(b).obsOpen > 0;
    default: return true;
  }
}

export function sortBoats(boats) {
  const depT = (b) => parseLocal(b.departure)?.getTime() ?? Infinity;
  const retT = (b) => parseLocal(b.returnDate)?.getTime() ?? Infinity;
  return [...boats].sort((a, b) => {
    if (a.inRental !== b.inRental) return a.inRental ? 1 : -1;
    const d = a.inRental ? retT(a) - retT(b) : depT(a) - depT(b);
    if (d && Number.isFinite(d)) return d;
    if (depT(a) !== depT(b) && !a.inRental) return depT(a) < depT(b) ? -1 : 1;
    return a.order - b.order || a.name.localeCompare(b.name, 'fr');
  });
}

export function nextDepartures(boats, now = new Date()) {
  return boats
    .filter((b) => !b.inRental && parseLocal(b.departure) && parseLocal(b.departure) > now)
    .sort((a, b) => parseLocal(a.departure) - parseLocal(b.departure));
}

export function fleetStats(boats, now = new Date()) {
  const f = { count: boats.length, rental: 0, blocked: 0, obsOpen: 0, late: 0, missing: 0, ready: 0, blockedBoats: 0 };
  boats.forEach((b) => {
    const mc = maintCounts(b, now);
    f.late += mc.late; f.missing += mc.missing;
    if (b.inRental) { f.rental++; return; }
    const st = boatStats(b);
    f.blocked += st.blocked; f.obsOpen += st.obsOpen;
    if (st.blocked) f.blockedBoats++;
    if (boatStatus(b).key === 'ready') f.ready++;
  });
  return f;
}

export const pinnedEvents = (b) => b.importantEvents.filter((e) => e.pinned);

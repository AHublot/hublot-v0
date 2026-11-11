// Modèle de données, normalisation (import de l'ancienne sauvegarde) et calculs dérivés.
import { uid, todayStr, nowIso, parseLocal, addDays, num, arr, cap, norm, clone } from './util.js';

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

// ---- Feuille retour : modèle par défaut (modifiable par les managers dans « Liste de préparation ») ----
// Chaque partie et chaque point a un id stable : renommer un point garde les réponses déjà données.
// Un point peut être spécial : { label, kind: 'mix' } = Fait / À faire + litres à mélanger.
const sec = (id, title, items, numf) => ({ id, title, ...(numf ? { num: numf } : {}), items: items.map((x, i) => ({ id: `${id}${i + 1}`, ...(typeof x === 'string' ? { label: x } : x) })) });
const ENGINE = ['Huile', 'Embase', 'Refroidissement', 'Courroie', 'Gatte et cale', 'Filtre eau de mer'];
export const SHEET_NUMS = {
  hoursPort: { label: 'Heures moteur', unit: 'h' },
  hoursStbd: { label: 'Heures moteur', unit: 'h' },
};
export const DEFAULT_RETURN_SHEET = [
  sec('mbd', 'Cale moteur bâbord', ENGINE, 'hoursPort'),
  sec('mtd', 'Cale moteur tribord', ENGINE, 'hoursStbd'),
  sec('bat', 'Batteries et barre', ['Cosses de batteries', 'Palonnier', 'Drosses', 'Axe et mèche de safran']),
  sec('plo', 'Plomberie', ['Pompe de cale', 'Pompe eau', 'WC bâbord', 'WC tribord', 'Douchette']),
  sec('cui', 'Cuisine', ['Gaz', 'Frigo']),
  sec('des', 'Dessalinisateur', ['Fonctionnement', 'Filtre']),
  sec('ele', 'Électronique', ['Pilote', 'GPS', 'Répétiteur', 'Info vent', 'Le sondeur fonctionne-t-il ?', 'Le gasoil est-il plein ?']),
  sec('coq', 'Coque et pont', ['Hublots', 'Poutre avant', 'Jupes', 'Fonds']),
  sec('gre', 'Gréement', ['Spinlock', 'Poulies', 'Drisses', 'Écoutes', 'Winchs', 'Vit de mulet', 'Drosse d’enrouleur']),
  sec('voi', 'Voiles et toiles', ['Grand-voile', 'Génois', 'Lazy bag', 'Bimini', 'Coussins']),
  sec('mou', 'Mouillage', ['Guindeau', 'Ancre et manille']),
  sec('ann', 'Annexe', ['Annexe', 'Moteur hors-bord', 'Hélice hors-bord', { label: 'Mélange', kind: 'mix' }]),
  sec('inv', 'Inventaire', ['Clef du bateau', 'Clef du cadenas', 'Amarres', 'Pompe annexe', 'Mouillage annexe', 'Pare-battages', 'Écope', 'Gilets', 'Gaffe', 'Brosse de pont']),
];
/** Modèle de feuille propre (ids présents, titres non vides) ; liste vide ou illisible → modèle par défaut. */
export function normalizeSheet(raw) {
  const out = arr(raw).filter((x) => x && typeof x === 'object').map((x) => ({
    id: String(x.id || uid()), title: String(x.title || 'Partie'),
    ...(x.num && SHEET_NUMS[x.num] ? { num: x.num } : {}),
    items: arr(x.items).filter((it) => it && String(it.label || '').trim()).map((it) => ({ id: String(it.id || uid()), label: String(it.label).trim(), ...(it.kind === 'mix' ? { kind: 'mix' } : {}) })),
  }));
  return out.length ? out : JSON.parse(JSON.stringify(DEFAULT_RETURN_SHEET));
}
export const sheetOf = (s) => normalizeSheet(s.returnSheet);
/** Feuille identique au modèle par défaut → on n'enregistre rien (null) : une future mise à jour du modèle s'appliquera. */
export const isDefaultSheet = (sh) => JSON.stringify(normalizeSheet(sh)) === JSON.stringify(DEFAULT_RETURN_SHEET);
// Premier modèle de test (9/11, avant les retouches d'Anthony) : traité comme « par défaut » pour basculer sur le nouveau.
const OLD_DEFAULT_SIG = 'Gasoil|Huile|Embase|Refroidissement|Courroie|Gatte et cale|Filtre eau de mer#Gasoil|Huile|Embase|Refroidissement|Courroie|Gatte et cale|Filtre eau de mer#Cosses de batteries|Palonnier|Drosses|Axe et mèche de safran#Pompe de cale|Pompe eau|Pompe eau de mer|WC bâbord|WC tribord|Douchette#Gaz|Frigo#Fonctionnement|Filtre#Pilote|GPS|Répétiteur|Info vent|Info sonde#Hublots|Fissures coque et pont|Poutre avant|Jupes|Fonds#Spinlock|Poulies|Drisses|Écoutes|Winchs|Vit de mulet|Drosse d’enrouleur#Grand-voile|Génois|Lazy bag|Bimini|Coussins#Guindeau|Ancre et manille#Annexe|Moteur hors-bord|Hélice hors-bord#Clef du bateau|Clef du cadenas|Amarres|Pompe annexe|Mouillage annexe|Pare-battages|Écope|Gilets|Gaffe|Brosse de pont';
const sigOf = (sh) => normalizeSheet(sh).map((x) => x.items.map((it) => it.label).join('|')).join('#');
export const storedSheet = (sh) => (sh && !isDefaultSheet(sh) && sigOf(sh) !== OLD_DEFAULT_SIG ? normalizeSheet(sh) : null);
/** Points d'une feuille, à plat. */
export const sheetItems = (sheet) => sheet.flatMap((x) => x.items.map((it) => ({ ...it, sec: x })));

// Catégories des tâches habituelles (affichage « Préparation »). Ordre = ordre d'affichage.
export const TPL_CATS = ['À l’arrivée du bateau', 'Technique courante', 'Nettoyage courant', 'Nettoyage fin', 'Finitions'];
export const TPL_OTHER = 'Autres';
export function guessTplCat(title = '') {
  const t = norm(title);
  if (/linge|approvision|noires|plein/.test(t)) return TPL_CATS[0];
  if (/\bgaz|dessal|entretien|grises/.test(t)) return TPL_CATS[1];
  if (/hublot/.test(t)) return TPL_CATS[3];
  if (/\bpont\b|ranger|video/.test(t)) return TPL_CATS[4];
  if (/cale|annexe|coffre|caillebot/.test(t)) return TPL_CATS[2];
  return TPL_OTHER;
}
export const tplCatOf = (s, title) => { const c = s.tplCats && s.tplCats[title]; return c && (TPL_CATS.includes(c) || c === TPL_OTHER) ? c : guessTplCat(title); };

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
// ---- moteurs : entretiens à l'heure ----------------------------------------------------------
// Les deux moteurs comptent comme un seul : on suit le compteur le plus haut des deux.
// Les entretiens suivis et leurs périodicités dépendent du modèle de moteur (page Moteurs).
export const ENGINE_TYPES = [
  { id: 'oil', label: 'Vidange + filtre à huile' },
  { id: 'fuel', label: 'Filtre à gasoil' },
  { id: 'prefuel', label: 'Préfiltre à gasoil' },
  { id: 'imp', label: 'Impeller' },
];
const DEFAULT_IV = { oil: { h: 200 }, fuel: { h: 400 }, prefuel: { h: 200 }, imp: { h: 600, d: 365 } };
/** « À prévoir » : ce qui tombera pendant la prochaine location (une semaine ≈ 30 h moteur). */
export const SOON_HOURS = 30;
export const defaultEngines = () => ({ types: clone(ENGINE_TYPES), models: [{ id: 'std', name: 'Moteur standard', iv: clone(DEFAULT_IV), parts: [] }] });
const posNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
export function normEngines(e) {
  if (!e || typeof e !== 'object') return defaultEngines();
  const types = arr(e.types).filter((t) => t && t.id).map((t) => ({ id: String(t.id), label: String(t.label || 'Entretien') }));
  const models = arr(e.models).filter((m) => m && m.id).map((m) => ({
    id: String(m.id), name: String(m.name || 'Moteur'),
    iv: Object.fromEntries(Object.entries(m.iv && typeof m.iv === 'object' ? m.iv : {}).map(([k, v]) => [k, { ...(posNum(v?.h) ? { h: posNum(v.h) } : {}), ...(posNum(v?.d) ? { d: posNum(v.d) } : {}) }])),
    parts: arr(m.parts).filter(Boolean).map((p) => ({ id: p.id || uid(), type: p.type || '', label: String(p.label || ''), ref: String(p.ref || ''), qty: String(p.qty ?? ''), note: String(p.note || '') })),
  }));
  const d = defaultEngines();
  return { types: types.length ? types : d.types, models: models.length ? models : d.models };
}
export const engConf = (s) => (s?.engines?.models?.length ? s.engines : defaultEngines());
/** Modèle de moteur du bateau (le premier de la liste s'il n'en a pas). */
export const engineModelOf = (s, b) => { const c = engConf(s); return c.models.find((m) => m.id === b.engineModel) || c.models[0]; };
/** Compteur suivi : le plus haut des deux moteurs. */
export function engCounter(b) {
  const lh = latestHours(b);
  if (!lh) return null;
  const v = [lh.port, lh.stbd].filter((x) => x != null);
  return v.length ? { h: Math.max(...v), side: lh.port != null && lh.port >= (lh.stbd ?? -1) ? 'bâbord' : 'tribord', date: lh.date, both: v.length === 2 } : null;
}
export const engRecord = (b, typeId) => arr(b.maintenance).find((m) => m.eng === typeId) || null;
const fmtHr = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
/** Où en est un entretien moteur sur un bateau (null si le modèle ne le suit pas). */
export function engItem(s, b, type, now = new Date(), cnt = engCounter(b)) {
  const iv = engineModelOf(s, b)?.iv?.[type.id] || {};
  if (!iv.h && !iv.d) return null;
  const rec = engRecord(b, type.id);
  const h = num(rec?.hours), d = rec?.date ? parseLocal(rec.date) : null, cur = cnt ? cnt.h : null;
  const out = { type, iv, rec, h, date: rec?.date || '', cur, next: null, left: null, leftDays: null, used: null, key: 'ok', label: 'À jour' };
  if (h == null && !d) return { ...out, key: 'missing', label: 'À renseigner' };
  const parts = [];
  let key = 'ok';
  if (iv.h && h != null) {
    out.next = h + iv.h;
    if (cur != null) {
      out.left = Math.round(out.next - cur);
      out.used = Math.min(100, Math.max(0, ((cur - h) / iv.h) * 100));
      if (out.left < 0) { key = 'late'; parts.push(`${-out.left} h de retard`); }
      else { if (out.left <= SOON_HOURS) key = 'soon'; parts.push(`encore ${out.left} h`); }
    } else parts.push(`prochaine à ${fmtHr(out.next)} h`);
  }
  if (iv.d && d) {
    out.leftDays = Math.round((addDays(d, iv.d) - now) / 864e5);
    if (out.leftDays < 0) { key = 'late'; parts.unshift(`en retard de ${-out.leftDays} j`); }
    else if (out.leftDays <= 30) { if (key !== 'late') key = 'soon'; parts.push(`dans ${out.leftDays} j`); }
  }
  return { ...out, key, label: cap(parts.join(' · ')) || 'À jour' };
}
/** Tous les entretiens moteur suivis pour ce bateau. */
export function engItems(s, b, now = new Date()) {
  const cnt = engCounter(b);
  return engConf(s).types.map((t) => engItem(s, b, t, now, cnt)).filter(Boolean);
}
/** Entretiens moteur à faire maintenant : en retard, ou qui tomberont pendant la prochaine location. */
export const engineDue = (s, b, now = new Date()) => engItems(s, b, now).filter((x) => x.key === 'late' || x.key === 'soon');
const ENG_RANK = { late: 0, soon: 1, missing: 2, ok: 3 };
/** Urgence d'un bateau (pour trier la flotte) : le plus pressé d'abord. */
export function engUrgency(s, b, now = new Date()) {
  const it = engItems(s, b, now);
  const rank = Math.min(4, ...it.map((x) => ENG_RANK[x.key]));
  const left = Math.min(Infinity, ...it.filter((x) => x.left != null).map((x) => x.left));
  return { rank, left, items: it };
}

export const mkTask = (title, tpl = false, extra = {}) => ({
  id: uid(), title, done: false, blocked: false, origin: todayStr(), ...(tpl ? { template: title } : {}), ...extra,
});

export function emptyState() {
  return {
    schema: SCHEMA, baseName: 'Ma base', team: [], templates: DEFAULT_TEMPLATES.slice(), tplCats: {}, returnSheet: null, engines: null, boats: [],
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
    returnDraft: r.returnDraft && typeof r.returnDraft === 'object' ? r.returnDraft : null,
    returnSheets: arr(r.returnSheets),
    stay: r.stay && typeof r.stay === 'object' ? r.stay : null,
    resa: r.resa && typeof r.resa === 'object' ? r.resa : null,
    resaDates: r.resaDates && typeof r.resaDates === 'object' ? r.resaDates : null,
    ...(r.engineModel ? { engineModel: String(r.engineModel) } : {}),
  };
  const fixTask = (t) => ({ ...t, id: t.id || uid(), title: String(t.title || ''), done: !!t.done, blocked: !!t.blocked });
  b.tasks = b.tasks.map(fixTask);
  b.pendingOnReturn = b.pendingOnReturn.map(fixTask);
  b.maintenance = b.maintenance.map((m) => {
    const g = guessInterval(m.title);
    return {
      id: m.id || uid(), title: m.title || 'Entretien', date: m.date || '', hours: m.hours || '', notes: m.notes || '',
      intervalDays: m.intervalDays ?? g.intervalDays, intervalHours: m.intervalHours ?? g.intervalHours,
      ...(m.by ? { by: m.by } : {}),
      ...(m.eng ? { eng: String(m.eng), log: arr(m.log) } : {}),
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
    schema: SCHEMA, baseName: d.baseName || 'Ma base', team, templates, tplCats: d.tplCats && typeof d.tplCats === 'object' ? { ...d.tplCats } : {}, returnSheet: storedSheet(d.returnSheet), engines: d.engines ? normEngines(d.engines) : null, boats,
    prefs: { autoDeparture: true, ...(d.prefs || {}) }, updatedAt: nowIso(),
  };
}

// ---- dérivés ---------------------------------------------------------------
export const baseLabel = (b) => (b.base === 'Autre' ? b.otherBase || 'Autre' : b.base || 'Sans base');
/** Observations à reprendre au retour (les anciennes données pouvaient y contenir des tâches habituelles). */
export const pendingObs = (b) => (b.pendingOnReturn || []).filter((t) => !t.template && !t.opt);
/** Options client de la prochaine location (observations « à embarquer » créées par les réservations). */
export const optsOf = (list) => (list || []).filter((t) => t.opt);
/** « Option client : Paddle ×2 » → « Paddle ×2 » (dans la liste Options, le préfixe est inutile). */
export const optLabel = (t) => String(t.title || '').replace(/^Option client\s*:\s*/i, '');
export const tplsOf = (s, b) => (b.templates?.length ? b.templates : s.templates);

/** Qui prépare ce bateau : les comptes qui ont coché au moins une tâche de la préparation en cours (le plus actif d'abord). */
export function crewOf(b) {
  const n = {};
  (b.inRental ? [] : b.tasks || []).forEach((t) => { if (t.done && t.doneBy) n[t.doneBy] = (n[t.doneBy] || 0) + 1; });
  return Object.keys(n).sort((x, y) => n[y] - n[x] || x.localeCompare(y, 'fr'));
}
export function boatStats(b) {
  const t = b.tasks;
  const rec = t.filter((x) => x.template);
  const obs = t.filter((x) => !x.template && !x.opt);
  const opt = t.filter((x) => x.opt);
  const done = t.filter((x) => x.done).length;
  return {
    total: t.length, done, open: t.length - done, pct: t.length ? Math.round((100 * done) / t.length) : 0,
    blocked: t.filter((x) => x.blocked && !x.done).length,
    recTotal: rec.length, recOpen: rec.filter((x) => !x.done).length,
    obsTotal: obs.length, obsOpen: obs.filter((x) => !x.done).length,
    optTotal: opt.length, optOpen: opt.filter((x) => !x.done).length,
  };
}

export function boatStatus(b) {
  if (b.inRental) return { key: 'rental', label: onConvoy(b) ? 'En convoyage' : 'En location' };
  // Bateaux des autres bases (Guadeloupe…) : on ne signale pas leurs départs, l'état vient des réservations.
  if (seaByResa(b)) return { key: 'rental', label: onConvoy(b) ? 'En convoyage' : 'En mer', resa: true };
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
      blocked: !!t.blocked, bill: !!t.bill, hours: t.hours || '', material: t.material || '', billed: !!t.billed, billedAt: t.billedAt || '', dossier: t.dossier || '', where, archivedAt: at,
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

/** Entretiens en retard, à prévoir, sans date. Avec `s` : les entretiens moteur comptent aussi (retard et à prévoir). */
export const maintCounts = (b, now = new Date(), s = null) => {
  let late = 0, missing = 0, soon = 0;
  b.maintenance.filter((m) => !m.eng).forEach((m) => {
    const k = maintStatus(m, b, now).key;
    if (k === 'late') late++; else if (k === 'missing') missing++; else if (k === 'soon') soon++;
  });
  if (s) engineDue(s, b, now).forEach((x) => { if (x.key === 'late') late++; else soon++; });
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
export function matchFilter(b, key, now = new Date(), s = null) {
  switch (key) {
    case 'rental': return b.inRental;
    case 'blocked': return !b.inRental && boatStats(b).blocked > 0;
    case 'late': return maintCounts(b, now, s).late > 0;
    case 'missing': return missingDates(b, now) > 0;
    case 'ready': return boatStatus(b).key === 'ready';
    case 'obs': return !b.inRental && boatStats(b).obsOpen > 0;
    default: return true;
  }
}

export function sortBoats(boats) {
  const depT = (b) => parseLocal(b.departure)?.getTime() ?? Infinity;
  const retT = (b) => parseLocal(b.returnDate)?.getTime() ?? Infinity;
  // Martinique en préparation d'abord, puis les bateaux en location, puis les autres bases
  const grp = (b) => (inMartinique(b) ? (b.inRental ? 1 : 0) : 2);
  return [...boats].sort((a, b) => {
    if (grp(a) !== grp(b)) return grp(a) - grp(b);
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

export function fleetStats(boats, now = new Date(), s = null) {
  const f = { count: boats.length, rental: 0, blocked: 0, obsOpen: 0, late: 0, missing: 0, ready: 0, blockedBoats: 0 };
  boats.forEach((b) => {
    const mc = maintCounts(b, now, s);
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

// ---- Réservations (API) ----------------------------------------------------------------------------
/** Séjour à montrer : en location → le séjour en cours ; à quai → le prochain. */
export const resaStay = (b) => (b.resa ? (b.inRental && !b.resa.conv ? b.resa.cur || b.resa.next : b.resa.next) : null);
/** Bateau « collé » : il rentre et repart le même jour (retour 9 h, départ 17 h). */
export function isTight(b) {
  // D'abord les dates de Hublot (saisies à la main comprises, ex. location hors réservations) :
  // en location, retour prévu et départ suivant le même jour.
  if (b.inRental && b.returnDate && b.departure && b.departure >= b.returnDate) return b.departure.slice(0, 10) === b.returnDate.slice(0, 10);
  const r = b.resa;
  if (!r) return false;
  // réservations avec convoyages : arrivée au port d'attache et départ suivant du même port, le même jour
  if ('homeRet' in r) return !!r.homeRet && !!r.homeDep && r.homeRet.slice(0, 10) === r.homeDep.slice(0, 10);
  if (!r.nextRet || !r.nextDep) return false;
  const ret = r.status === 'sea' ? r.nextRet : r.next?.ret;
  const dep = r.status === 'sea' ? r.nextDep : '';
  // seulement au Marin : retour et départ suivant en Martinique
  const here = MQ.test(r.cur?.retBase || '') && MQ.test(r.next?.depBase || '');
  return here && !!ret && !!dep && ret.slice(0, 10) === dep.slice(0, 10);
}
/** L'état des réservations (en mer / à quai) ne correspond pas à Hublot. */
export const resaMismatch = (b) => inMartinique(b) && !!b.resa && (b.resa.status === 'sea') !== !!b.inRental;
/** En mer d'après les réservations, pour un bateau hors Martinique (ses départs ne sont pas signalés dans Hublot). */
export function seaByResa(b) { return !b.inRental && !inMartinique(b) && b.resa?.status === 'sea'; }
// Où est le bateau d'après les réservations : base du séjour en cours (en mer) ou base actuelle (à quai).
const MQ = /\ble marin\b|martinique/i; // attention : « Marina Bas-du-Fort » contient « marin »
/** Base de la réservation = la base d'attache du bateau dans Hublot ? (Martinique : Le Marin ; Guadeloupe : Bas-du-Fort.) Base inconnue = oui. */
export function homeBase(b, base) {
  if (!base) return true;
  if (b.base === 'Martinique') return MQ.test(base);
  if (b.base === 'Guadeloupe') return !MQ.test(base);
  return true;
}
/** Pendant un convoyage inter-îles (en mer, sans séjour client). */
export const onConvoy = (b) => b.resa?.status === 'sea' && !!b.resa.conv;
export function resaPlace(b) {
  const r = b.resa;
  if (!r) return '';
  // en mer : base d'arrivée du mouvement en cours (location ou convoyage)
  return r.status === 'sea' ? (r.retBase || r.cur?.retBase || r.cur?.depBase || '') : r.base || '';
}
/** Le bateau est-il en Martinique ? Sa base dans Hublot, sauf si les réservations le placent ailleurs (loué en Guadeloupe). */
export function inMartinique(b) {
  const p = resaPlace(b);
  if (p && !MQ.test(p)) return false;
  return b.base === 'Martinique';
}
/** Numéro de dossier affiché : les 4 derniers chiffres (« ACM-2026-5426 » → « 5426 »). */
export const shortDossier = (d) => { const m = String(d || '').match(/(\d+)\D*$/); return m ? m[1].slice(-4) : String(d || ''); };

// Réservations (API Booking Manager d'ACM, fournie par un collègue) → dates prévues, dossier, options.
// Le serveur interroge l'API 3 fois par jour (6 h, 12 h, 16 h, heure de Martinique) + à la demande d'un manager.
// La clé reste dans l'environnement du VPS (RESA_KEY), jamais dans le code ni dans la base.
// Données personnelles : on ne garde que les noms (client, skipper, hôtesse), jamais téléphone ni e-mail.
import { applySync } from './lib.js';
import { stable } from '../src/merge.js';
import { homeBase } from '../src/model.js';

export const RESA_HOURS = [6, 12, 16];
/** Location au départ de la Martinique ? Les options d'une location qui part de Guadeloupe sont embarquées là-bas. */
export const fromMartinique = (boat, st) => (st?.depBase ? homeBase({ base: 'Martinique' }, st.depBase) : boat.base !== 'Guadeloupe');
const TZ_OFFSET_H = -4; // Martinique = UTC−4, sans heure d'été

// Options utiles à l'équipe technique (les autres — annexe, linge de lit, nettoyage, caution — sont dans toutes les locations).
export const OPTION_GROUPS = [
  { key: 'paddle', label: 'Paddle', re: /paddle/i },
  { key: 'bbq', label: 'BBQ', re: /barbecue|bbq/i },
  { key: 'sunchill', label: 'Sunchill', re: /sunchill/i },
  { key: 'starlink', label: 'Starlink', re: /starlink/i },
  { key: 'linge', label: 'Linge sup.', re: /linge suppl|extra linen/i },
  { key: 'kayak', label: 'Kayak', re: /kayak/i },
  { key: 'peche', label: 'Canne à pêche', re: /p[eê]che|fishing/i },
  { key: 'serviettes', label: 'Serviettes de plage', re: /serviette|beach towel/i },
];
export function pickOptions(list) {
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    const g = OPTION_GROUPS.find((x) => x.re.test(String(o?.nom || '')));
    if (!g) continue;
    const q = Number(o.quantite) || 1;
    const have = out.find((x) => x.key === g.key);
    if (have) have.qty += q; else out.push({ key: g.key, label: g.label, qty: q });
  }
  return out;
}

/** Date ISO UTC de l'API → date locale Martinique « AAAA-MM-JJTHH:MM » (format des champs de Hublot). */
export function toLocal(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t + TZ_OFFSET_H * 3600e3).toISOString().slice(0, 16);
}
const nm = (p) => (p && typeof p.nom === 'string' && p.nom.trim() ? p.nom.trim() : '');
function stayOf(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    dossier: String(s.dossier || ''), coque: String(s.coque || ''),
    dep: toLocal(s.depart?.date), depBase: String(s.depart?.base || ''),
    ret: toLocal(s.retour?.date), retBase: String(s.retour?.base || ''),
    mode: s.mode === 'skipper' ? 'skipper' : 'bareboat',
    client: nm(s.chef_de_bord), skipper: s.mode === 'skipper' ? nm(s.skipper) || 'à attribuer' : '',
    hostess: s.hotesse?.prevue ? (nm(s.hotesse) || 'prévue') : '',
    options: pickOptions(s.options),
  };
}
/** Réponse de l'API pour un bateau → ce que Hublot garde. */
export function compactResa(d, at = new Date().toISOString()) {
  return {
    at, status: d.statut === 'en_mer' ? 'sea' : 'quay', base: String(d.base_actuelle || ''),
    nextDep: toLocal(d.prochain_depart?.date), nextRet: toLocal(d.prochain_retour?.date),
    cur: stayOf(d.sejour_en_cours), next: stayOf(d.prochain_sejour),
    // convoyages (API v2) : base et type des prochains départ / retour, deux prochains mouvements
    depBase: String(d.prochain_depart?.base || ''), depType: d.prochain_depart?.type === 'convoyage' ? 'convoyage' : 'location',
    retBase: String(d.prochain_retour?.base || ''),
    conv: d.statut === 'en_mer' && !d.sejour_en_cours && Array.isArray(d.prochains_mouvements),
    moves: (Array.isArray(d.prochains_mouvements) ? d.prochains_mouvements : []).slice(0, 2).map(moveOf),
  };
}
/** Un mouvement : location ou convoyage (convoyeur : le nom seulement). */
function moveOf(m) {
  const conv = m?.type === 'convoyage';
  return {
    type: conv ? 'convoyage' : 'location',
    dep: toLocal(m?.depart?.date), depBase: String(m?.depart?.base || ''),
    ret: toLocal(m?.retour?.date), retBase: String(m?.retour?.base || ''),
    ...(conv ? { who: nm(m.convoyeur), critique: !!m.critique } : { dossier: String(m?.dossier || '') }),
  };
}
/**
 * Dates qui comptent pour l'équipe du bateau : prochain départ de SON port (location ou convoyage),
 * et, s'il est parti, son arrivée à SON port (retour de location ou arrivée d'un convoyage).
 */
export function homeDates(boat, r) {
  // en mer, le premier mouvement est celui en cours : son départ est déjà passé
  const next = (r.moves || []).slice(r.status === 'sea' ? 1 : 0);
  const legs = [{ date: r.nextDep, base: r.depBase, type: r.depType }, ...next.map((m) => ({ date: m.dep, base: m.depBase, type: m.type })), { date: r.next?.dep, base: r.next?.depBase, type: 'location' }];
  const dep = legs.filter((x) => x.date && homeBase(boat, x.base)).sort((a, b) => a.date.localeCompare(b.date))[0];
  // à quai à son port : rien à attendre (ou location hors réservations)
  const away = r.status === 'sea' || !homeBase(boat, r.base);
  const rets = [{ date: r.status === 'sea' ? r.nextRet : '', base: r.retBase }, ...(r.moves || []).map((m) => ({ date: m.ret, base: m.retBase }))];
  const ret = away ? rets.filter((x) => x.date && homeBase(boat, x.base)).sort((a, b) => a.date.localeCompare(b.date))[0] : null;
  return { homeDep: dep?.date || '', homeDepType: dep?.type || '', homeRet: ret?.date || '' };
}

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Noms d'adresse à essayer pour un bateau : « isla-madinina », puis « islamadinina ». */
export const slugsFor = (name) => [...new Set([slug(name), slug(name).replace(/-/g, '')])].filter(Boolean);

/**
 * Opérations à appliquer à un bateau. Les dates sont un pré-remplissage : on ne remplace une date que si elle est vide
 * ou si elle vaut encore la dernière valeur posée par les réservations (sinon quelqu'un l'a modifiée à la main).
 */
export function resaOps(boat, r) {
  const ops = [];
  const last = boat.resaDates || {};
  const set = (k, v) => { if (stable(boat[k]) !== stable(v)) ops.push({ op: 'set', k, v }); };
  const keep = { ...last };
  const fill = (k, v) => {
    if (!v) return;
    const cur = boat[k] || '';
    // départ déjà effectué (bateau parti à cette date) : la date n'a plus d'intérêt, on prend la suivante
    const done = k === 'departure' && boat.inRental && cur === (boat.lastDeparture || '');
    if (!cur || cur === last[k] || done) { set(k, v); keep[k] = v; }
  };
  if (Array.isArray(r.moves) && r.moves.length) r = { ...r, ...homeDates(boat, r) };
  const dep = 'homeDep' in r ? r.homeDep : r.nextDep;
  const ret = 'homeRet' in r ? r.homeRet : r.status === 'sea' ? r.nextRet : '';
  fill('departure', dep);
  if (boat.inRental) fill('returnDate', ret);
  // parti hors de son port sans retour prévu (loué depuis l'autre île) : l'ancienne date des réservations n'a plus de sens
  if (boat.inRental && 'homeRet' in r && !r.homeRet && last.returnDate && boat.returnDate === last.returnDate) { set('returnDate', ''); keep.returnDate = ''; }
  set('resa', r);
  set('resaDates', keep);
  // Séjour en cours : dossier, client, skipper, dates, options → en-tête de la feuille retour (pendant la location dans Hublot).
  if (boat.inRental && r.status === 'sea' && r.cur) {
    set('stay', { dossier: r.cur.dossier, client: r.cur.client, skipper: r.cur.skipper && r.cur.skipper !== 'à attribuer' ? r.cur.skipper : '', dep: r.cur.dep, ret: r.cur.ret, options: fromMartinique(boat, r.cur) ? r.cur.options : [] });
  }
  ops.push(...optionTaskOps(boat, r));
  return ops;
}

/** Interroge l'API pour chaque bateau et enregistre. Renvoie un petit bilan. */
export async function syncResa(db, { key, url, fetchImpl = fetch, now = new Date() } = {}) {
  if (!key) return { ok: false, error: 'RESA_KEY absente' };
  const base = (url || 'https://acm-caraibes.com/hublot/').replace(/\/?$/, '/');
  const rows = db.prepare('SELECT id, data FROM boats WHERE deleted = 0').all();
  const at = now.toISOString();
  const patches = [], missing = [], errors = [];
  for (const row of rows) {
    const b = JSON.parse(row.data);
    let d = null;
    for (const s of slugsFor(b.name)) {
      try {
        const res = await fetchImpl(base + encodeURIComponent(s) + '?format=json', { headers: { 'X-Hublot-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (res.status === 404) continue;
        if (!res.ok) { errors.push(`${b.name} : ${res.status}`); break; }
        d = await res.json();
        break;
      } catch (e) { errors.push(`${b.name} : ${e.message}`); break; }
    }
    if (!d) { if (!errors.some((x) => x.startsWith(b.name))) missing.push(b.name); continue; }
    const ops = resaOps(b, compactResa(d, at));
    if (ops.length) patches.push({ id: b.id, ops });
  }
  if (patches.length) applySync(db, null, { patches }, { role: 'manager', name: 'Réservations' });
  const info = { at, ok: !errors.length, updated: patches.length, boats: rows.length, missing, errors };
  db.prepare("INSERT INTO meta (k, data, version, updated_at, updated_by) VALUES ('resa', ?, 0, ?, NULL) ON CONFLICT(k) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").run(JSON.stringify(info), at);
  return info;
}
export function resaInfo(db) {
  const r = db.prepare("SELECT data FROM meta WHERE k = 'resa'").get();
  return r ? JSON.parse(r.data) : null;
}
/** Créneau (6 h, 12 h, 16 h Martinique) en cours, ou null. */
export function dueSlot(now = new Date()) {
  const local = new Date(now.getTime() + TZ_OFFSET_H * 3600e3);
  const h = local.getUTCHours();
  return RESA_HOURS.includes(h) ? `${local.toISOString().slice(0, 10)}T${h}` : null;
}

/**
 * Options de la prochaine location → observations à cocher, pour ne rien oublier d'embarquer.
 * Les options arrivent souvent au dernier moment et une par une : chaque récupération ajoute celles qui manquent,
 * met à jour la quantité, et retire (si elles ne sont pas cochées) celles qui ne sont plus réservées.
 * Bateau à quai → dans la préparation ; en location → « à reprendre au retour » (elles passent dans la préparation au retour).
 */
export const optTitle = (o) => `Option client : ${o.label}${o.qty > 1 ? ` ×${o.qty}` : ''}`;
export function optionTaskOps(boat, r, today = new Date(Date.now() + TZ_OFFSET_H * 3600e3).toISOString().slice(0, 10)) {
  const ops = [];
  const next = r.next;
  const list = boat.inRental ? 'pendingOnReturn' : 'tasks';
  const want = next && next.dossier && fromMartinique(boat, next) ? next.options : [];
  const all = [['tasks', boat.tasks || []], ['pendingOnReturn', boat.pendingOnReturn || []]];
  // retirer les options non cochées qui ne correspondent plus à la prochaine location
  for (const [a, items] of all) {
    for (const t of items) {
      if (!t.opt || t.done) continue;
      const still = next && t.dossier === next.dossier && want.some((o) => o.key === t.opt) && a === list;
      if (!still) ops.push({ op: 'del', a, key: `i${t.id}` });
    }
  }
  for (const o of want) {
    const have = (boat[list] || []).find((t) => t.opt === o.key && t.dossier === next.dossier);
    if (have) {
      if (!have.done && have.title !== optTitle(o)) ops.push({ op: 'upd', a: list, key: `i${have.id}`, set: { title: optTitle(o) }, unset: [] });
      continue;
    }
    const id = `opt-${next.dossier}-${o.key}`.replace(/[^\w-]/g, '');
    ops.push({ op: 'add', a: list, key: `i${id}`, item: { id, title: optTitle(o), done: false, blocked: false, origin: today, opt: o.key, dossier: next.dossier, ...(boat.inRental ? { carried: true } : {}) } });
  }
  return ops;
}

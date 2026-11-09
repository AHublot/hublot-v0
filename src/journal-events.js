// Journal (manager) : transforme une modification de bateau en lignes « qui a fait quoi ».
// Module pur, utilisé par le serveur à chaque synchronisation.

/** Durée de conservation du journal, en jours. */
export const JOURNAL_DAYS = 7;

const byId = (list) => new Map((Array.isArray(list) ? list : []).filter((x) => x && x.id != null).map((x) => [String(x.id), x]));
const txt = (v, n = 160) => String(v ?? '').trim().slice(0, n);
const dt = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m ? `${m[3]}/${m[2]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}` : '';
};

/**
 * Événements entre l'état avant (`cur`) et après (`next`) d'un bateau.
 * Retourne [{ kind, what, note }] ; kind : done, undone, added, blocked, unblocked, dep, ret, hours, maint, date, event, removed, renamed.
 */
export function journalEvents(cur, next) {
  if (!cur || !next) return [];
  const out = [];
  const push = (kind, what = '', note = '') => out.push({ kind, what: txt(what), note: txt(note, 120) });

  // Départ ou retour : une seule ligne, sans le détail des tâches archivées ou remises à zéro.
  const curH = new Set((cur.history || []).map((h) => String(h?.id)));
  const newH = (next.history || []).filter((h) => h && !curH.has(String(h.id)));
  const flip = !!cur.inRental !== !!next.inRental;
  if (flip || newH.length) {
    const dep = flip ? !!next.inRental : newH.some((h) => h.kind === 'departure');
    push(dep ? 'dep' : 'ret', dep ? 'Départ client' : 'Retour signalé');
    const curS = new Set((cur.returnSheets || []).map((x) => String(x?.id)));
    (next.returnSheets || []).filter((x) => x && !curS.has(String(x.id))).forEach((x) => {
      const n = Object.values(x.values || {}).filter((v) => v === 'def').length;
      push('sheet', 'Feuille retour', [x.stay?.dossier ? `Dossier ${x.stay.dossier}` : '', n ? `${n} défaut${n > 1 ? 's' : ''}` : 'aucun défaut'].filter(Boolean).join(' · '));
    });
    return out;
  }

  const tasks = (k) => {
    const a = byId(cur[k]), b = byId(next[k]);
    for (const [id, t] of b) {
      const o = a.get(id);
      if (!o) { if (!t.template) push('added', t.title, k === 'pendingOnReturn' ? 'À reprendre au retour' : ''); continue; }
      if (!!o.done !== !!t.done) push(t.done ? 'done' : 'undone', t.title);
      if (!!o.blocked !== !!t.blocked) push(t.blocked ? 'blocked' : 'unblocked', t.title);
      if (o.title !== t.title && !t.template) push('renamed', t.title, `Avant : ${o.title}`);
    }
    for (const [id, o] of a) if (!b.has(id) && !o.template) push('removed', o.title);
  };
  tasks('tasks');
  tasks('pendingOnReturn');

  const ma = byId(cur.maintenance);
  for (const [id, m] of byId(next.maintenance)) {
    const o = ma.get(id);
    if (!o) { push('maint', m.title, 'Entretien ajouté'); continue; }
    if (o.date !== m.date || o.hours !== m.hours || o.notes !== m.notes) {
      push('maint', m.title, [m.date && o.date !== m.date ? `Contrôle du ${dt(m.date)}` : '', m.hours && o.hours !== m.hours ? `${m.hours} h` : ''].filter(Boolean).join(' · '));
    }
  }
  const ea = byId(cur.importantEvents);
  for (const [id, e] of byId(next.importantEvents)) if (!ea.has(id)) push('event', e.title);

  const h0 = cur.hours || {}, h1 = next.hours || {};
  if ((h0.port || '') !== (h1.port || '') || (h0.stbd || '') !== (h1.stbd || '')) {
    push('hours', 'Heures moteur', `Bâbord ${h1.port || '—'} h · Tribord ${h1.stbd || '—'} h`);
  }
  if ((cur.departure || '') !== (next.departure || '')) push('date', next.departure ? dt(next.departure) : 'Effacé', 'Départ prévu');
  if ((cur.returnDate || '') !== (next.returnDate || '')) push('date', next.returnDate ? dt(next.returnDate) : 'Effacé', 'Retour prévu');
  return out;
}

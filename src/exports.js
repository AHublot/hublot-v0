// Export des observations (refacturation propriétaire). Sans DOM : testé sous Node.
import { csvCell } from './util.js';
import { observationsOf, obsDate, obsState, baseLabel } from './model.js';

const fr = (day) => (day && /^\d{4}-\d{2}-\d{2}/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '');
const localDay = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Observations de la flotte, filtrées.
 * boat : identifiant ou 'all' · status : 'all' | 'done' | 'open' · bill : 'all' | 'bill' (à refacturer) · from / to : 'AAAA-MM-JJ' (inclus),
 * appliqués à la date de règlement, ou à la date de constat si l'observation n'est pas réglée.
 */
export function collectObservations(s, { boat = 'all', status = 'all', from = '', to = '', bill = 'all' } = {}) {
  const out = [];
  s.boats.forEach((b) => {
    if (boat !== 'all' && b.id !== boat) return;
    observationsOf(b).forEach((o) => {
      if (status === 'done' && !o.done) return;
      if (status === 'open' && o.done) return;
      if (bill === 'bill' && !o.bill) return;
      const d = obsDate(o);
      if (from && (!d || d < from)) return;
      if (to && (!d || d > to)) return;
      out.push({ ...o, boatId: b.id, boatName: b.name, base: baseLabel(b) });
    });
  });
  return out.sort((x, y) => x.boatName.localeCompare(y.boatName, 'fr') || obsDate(x).localeCompare(obsDate(y)));
}

/** CSV pour Excel (français) : séparateur « ; », BOM UTF-8, dates JJ/MM/AAAA. */
export function observationsCsv(rows) {
  const head = ['Bateau', 'Base', 'Observation', 'Statut', 'Bloquante', 'À refacturer', 'Montant (€)', 'Constatée le', 'Réglée le', 'Archivée le'];
  const lines = rows.map((o) => [
    o.boatName, o.base, o.title, obsState(o).label, o.blocked ? 'Oui' : '', o.bill ? 'Oui' : '', o.amount ? String(o.amount).replace('.', ',') : '',
    fr(o.origin), fr(localDay(o.doneAt)), o.where === 'archive' ? fr(o.archivedAt.length > 10 ? localDay(o.archivedAt) : o.archivedAt) : '',
  ]);
  return '﻿' + [head, ...lines].map((r) => r.map(csvCell).join(';')).join('\r\n');
}

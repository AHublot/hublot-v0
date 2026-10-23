// Messages prêts à coller dans WhatsApp (gras = *texte*).
import { fmtWDT, fmtD, parseLocal, fmtCountdown, dayDiff } from './util.js';
import { boatStats, baseLabel, pinnedEvents, sortBoats, maintCounts } from './model.js';

export function boatReport(b, now = new Date()) {
  const st = boatStats(b);
  const dep = parseLocal(b.departure);
  const L = [`*${b.name}* · ${baseLabel(b)}`];
  if (b.inRental) {
    L.push(`En location${b.returnDate ? ` · retour prévu ${fmtWDT(b.returnDate)}` : ''}`);
    if (b.pendingOnReturn.length) L.push('', `À reprendre au retour (${b.pendingOnReturn.length}) :`, ...b.pendingOnReturn.map((t) => `• ${t.title}`));
    return L.join('\n');
  }
  L.push(dep ? `Départ ${fmtWDT(b.departure)}${dep > now ? ` (dans ${fmtCountdown(dep, now)})` : ' (dépassé)'}` : 'Départ à renseigner');
  L.push(`Préparation : ${st.done}/${st.total} (${st.pct} %)`);
  if (b.techs.length) L.push(`Équipe : ${b.techs.join(', ')}`);
  const open = b.tasks.filter((t) => !t.done);
  const blocked = open.filter((t) => t.blocked);
  const obs = open.filter((t) => !t.template && !t.blocked);
  const rec = open.filter((t) => t.template && !t.blocked);
  if (blocked.length) L.push('', `🚫 Bloquant (${blocked.length}) :`, ...blocked.map((t) => `• ${t.title}`));
  if (obs.length) L.push('', `🔧 Observations (${obs.length}) :`, ...obs.map((t) => `• ${t.title}`));
  if (rec.length) L.push('', `⬜ Habituel (${rec.length}) :`, ...rec.map((t) => `• ${t.title}`));
  if (!open.length) L.push('', '✅ Tout est fait.');
  const pins = pinnedEvents(b);
  if (pins.length) L.push('', '📌 À retenir :', ...pins.map((e) => `• ${e.title}`));
  const mc = maintCounts(b, now);
  if (mc.late) L.push('', `⚠️ ${mc.late} entretien${mc.late > 1 ? 's' : ''} en retard`);
  return L.join('\n');
}

export function fleetReport(s, now = new Date()) {
  const L = [`*${s.baseName} · point flotte* (${fmtD(now)})`];
  const prep = sortBoats(s.boats).filter((b) => !b.inRental);
  if (prep.length) L.push('', '*À préparer*');
  prep.forEach((b) => {
    const st = boatStats(b);
    const d = b.departure ? dayDiff(b.departure, now) : null;
    const when = b.departure ? `${fmtWDT(b.departure)} (${d <= 0 ? 'aujourd’hui' : `J-${d}`})` : 'départ à fixer';
    L.push(`• ${b.name} — ${when} — ${st.done}/${st.total}${st.blocked ? ` · 🚫 ${st.blocked} bloquant${st.blocked > 1 ? 's' : ''}` : ''}${st.obsOpen ? ` · 🔧 ${st.obsOpen}` : ''}`);
  });
  const rent = s.boats.filter((b) => b.inRental);
  if (rent.length) L.push('', '*En location*', ...rent.map((b) => `• ${b.name}${b.returnDate ? ` — retour ${fmtWDT(b.returnDate)}` : ''}`));
  return L.join('\n');
}

export const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

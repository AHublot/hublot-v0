// Petits utilitaires sans dépendance. Aucun accès au DOM ici : ce fichier est aussi testé sous Node.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export const pad = (n) => String(n).padStart(2, '0');
export const arr = (x) => (Array.isArray(x) ? x : []);
export const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
export const plural = (n, a, b) => `${n} ${n > 1 ? b : a}`;
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const initials = (n) =>
  String(n).trim().split(/\s+/).slice(0, 2).map((w) => (w[0] || '').toUpperCase()).join('');
export const slug = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const num = (x) => {
  const n = parseFloat(String(x ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// ---- dates ---------------------------------------------------------------
// Les départs sont stockés « naïfs » (AAAA-MM-JJTHH:mm, heure locale de la base),
// exactement comme dans la sauvegarde d'origine.
export const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const nowLocal = (d = new Date()) => `${todayStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const nowIso = () => new Date().toISOString();
export const parseLocal = (s) => {
  if (!s) return null;
  const d = new Date(String(s).length <= 10 ? s + 'T00:00' : s);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const dayDiff = (s, now = new Date()) => {
  const d = parseLocal(s);
  return d ? Math.round((startOfDay(d) - startOfDay(now)) / 864e5) : null;
};

const mk = (o) => { try { return new Intl.DateTimeFormat('fr-FR', o); } catch { return { format: (d) => d.toISOString() }; } };
const F = {
  dt: mk({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  d: mk({ day: 'numeric', month: 'short' }),
  wd: mk({ weekday: 'short', day: 'numeric', month: 'short' }),
  wdt: mk({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  long: mk({ weekday: 'long', day: 'numeric', month: 'long' }),
  hm: mk({ hour: '2-digit', minute: '2-digit' }),
  mo: mk({ month: 'short' }),
};
const fmt = (k) => (s) => { const d = s instanceof Date ? s : parseLocal(s); return d ? F[k].format(d) : ''; };
export const fmtDT = fmt('dt');
export const fmtD = fmt('d');
export const fmtWD = fmt('wd');
export const fmtWDT = fmt('wdt');
export const fmtLong = fmt('long');
export const fmtHM = fmt('hm');
export const fmtMonth = fmt('mo');

export function countdownParts(target, now = new Date()) {
  const ms = target - now;
  let a = Math.abs(ms);
  const d = Math.floor(a / 864e5); a -= d * 864e5;
  const h = Math.floor(a / 36e5); a -= h * 36e5;
  const m = Math.floor(a / 6e4);
  return { neg: ms < 0, d, h, m, ms };
}
export function fmtCountdown(target, now = new Date()) {
  const p = countdownParts(target, now);
  if (p.neg) return 'dépassé';
  if (p.d > 0) return `${p.d} j ${p.h} h`;
  if (p.h > 0) return `${p.h} h ${pad(p.m)} min`;
  return `${p.m} min`;
}
export const utcLabel = () => {
  const o = -new Date().getTimezoneOffset();
  const a = Math.abs(o);
  return `UTC${o < 0 ? '−' : '+'}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
};

// ---- texte ---------------------------------------------------------------
/** « Une tâche par ligne, ou séparée par un point-virgule. » Préfixe « ! » = bloquant. */
export function parseObservations(text) {
  const seen = new Set();
  const out = [];
  String(text || '')
    .split(/\n|;/)
    .map((l) => l.trim())
    .forEach((l) => {
      if (!l) return;
      let blocked = false;
      if (l.startsWith('!')) { blocked = true; l = l.replace(/^!+\s*/, ''); }
      l = l.replace(/^([-•*–—]|\d+[.)])\s+/, '').trim();
      if (!l) return;
      l = cap(l);
      const k = norm(l);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ title: l, blocked });
    });
  return out;
}

export const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export const byDescDate = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

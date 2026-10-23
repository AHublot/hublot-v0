import { esc, fmtCountdown, parseLocal } from '../util.js';
import { ic } from '../icons.js';

export const pill = (st) => `<span class="pill ${st.key}">${esc(st.label)}</span>`;
export const bar = (pct, cls = '') => `<span class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span>`;

/** Compte à rebours vivant : le texte est rafraîchi chaque minute sans refaire le rendu. */
export const cd = (dateStr, now = new Date()) => {
  const t = parseLocal(dateStr);
  if (!t) return '';
  return `<span class="cd" data-cd="${esc(dateStr)}">${esc(fmtCountdown(t, now))}</span>`;
};
export function tickCountdowns(root = document, now = new Date()) {
  root.querySelectorAll('[data-cd]').forEach((el) => {
    const t = parseLocal(el.dataset.cd);
    if (t) el.textContent = fmtCountdown(t, now);
  });
}

export const empty = (icon, title, text = '', action = '') =>
  `<div class="empty">${ic(icon)}<strong>${esc(title)}</strong>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;

export const sparkline = (values, w = 160, h = 36) => {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * (w - 4) + 2},${h - 4 - ((x - min) / span) * (h - 8)}`);
  const last = pts.at(-1).split(',');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="currentColor"/></svg>`;
};

// Envoi des feuilles retour par e-mail (Brevo), dès qu'une feuille est validée.
// La clé reste dans l'environnement du VPS (BREVO_KEY), jamais dans le code ni dans la base.
// Les adresses des destinataires sont réglées par les managers (meta « mail », jamais envoyée aux téléphones).
import { sheetPdf, sheetFileName, sheetFindings, fmtWhen } from './sheet-pdf.js';
import { shortDossier } from '../src/model.js';

const RETRY_MIN = [1, 5, 15, 60, 180, 720]; // délais entre deux essais, en minutes
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const validEmail = (s) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(String(s || '').trim());

export function mailConfig(env = process.env) {
  return { key: env.BREVO_KEY || '', from: env.MAIL_FROM || '', fromName: env.MAIL_FROM_NAME || 'Hublot', replyTo: env.MAIL_REPLY_TO || '', url: (env.PUBLIC_URL || 'https://hublot.lemard.fr/').replace(/\/?$/, '/') };
}
export function initMail(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS mail_queue (
    id INTEGER PRIMARY KEY, boat_id TEXT NOT NULL, sheet_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'wait',
    tries INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, error TEXT, sent_at TEXT, created_at TEXT NOT NULL, UNIQUE (boat_id, sheet_id))`);
}
export function mailSettings(db) {
  const r = db.prepare("SELECT data FROM meta WHERE k = 'mail'").get();
  const d = r ? JSON.parse(r.data) : {};
  return { to: Array.isArray(d.to) ? d.to : [] };
}
export function saveMailSettings(db, { to } = {}) {
  const list = [...new Set((Array.isArray(to) ? to : String(to || '').split(/[\s,;]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  const bad = list.filter((x) => !validEmail(x));
  if (bad.length) { const e = new Error(`Adresse invalide : ${bad.join(', ')}`); e.code = 400; throw e; }
  const at = new Date().toISOString();
  db.prepare("INSERT INTO meta (k, data, version, updated_at, updated_by) VALUES ('mail', ?, 0, ?, NULL) ON CONFLICT(k) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").run(JSON.stringify({ to: list }), at);
  return { to: list };
}
/** Feuilles validées dans un envoi : on les met en file (une fois chacune). */
export function enqueueSheets(db, sheets) {
  const ins = db.prepare('INSERT OR IGNORE INTO mail_queue (boat_id, sheet_id, next_at, created_at) VALUES (?, ?, ?, ?)');
  const at = new Date().toISOString();
  for (const s of sheets || []) ins.run(s.boatId, s.sheetId, at, at);
}
export function mailStatus(db, limit = 8) {
  return db.prepare('SELECT q.boat_id, q.sheet_id, q.status, q.tries, q.error, q.sent_at, q.created_at, b.data FROM mail_queue q LEFT JOIN boats b ON b.id = q.boat_id ORDER BY q.id DESC LIMIT ?').all(limit)
    .map((r) => { const b = r.data ? JSON.parse(r.data) : {}; return { boat: b.name || '?', status: r.status, tries: r.tries, error: r.error || '', sentAt: r.sent_at, at: r.created_at }; });
}

/** Contenu de l'e-mail d'une feuille retour. */
export function sheetMail(boat, r, cfg) {
  const { defs, client } = sheetFindings(r);
  const st = r.stay || {};
  const dos = st.dossier ? ` · dossier ${shortDossier(st.dossier)}` : '';
  const subject = `Feuille retour · ${boat.name}${dos} · ${defs.length ? `${defs.length} défaut${defs.length > 1 ? 's' : ''}` : 'aucun défaut'}`;
  const link = `${cfg.url}#/retour/${encodeURIComponent(boat.id)}/${encodeURIComponent(r.id)}`;
  const li = (t, sub, color) => `<tr><td style="padding:6px 0 6px 10px;border-left:3px solid ${color}"><b>${esc(t)}</b>${sub ? `<br><span style="color:#5d6f7c;font-size:13px">${sub}</span>` : ''}</td></tr><tr><td style="height:6px"></td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef4f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4f7;padding:20px 10px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:22px;font-family:Arial,Helvetica,sans-serif;color:#14212b;font-size:15px;line-height:1.45">
<tr><td style="font-size:12px;font-weight:bold;color:#0b7f8a;letter-spacing:.06em">FEUILLE RETOUR</td></tr>
<tr><td style="font-size:26px;font-weight:bold;color:#0c2b3d;padding:2px 0 6px">${esc(boat.name)}</td></tr>
<tr><td style="color:#5d6f7c;font-size:14px;padding-bottom:14px;border-bottom:2px solid #0b7f8a">Validée le ${esc(fmtWhen(r.at, { year: true }))}${r.by ? ` par ${esc(r.by)}` : ''}${st.dossier ? `<br>Dossier ${esc(st.dossier)}` : ''}${st.client ? ` · ${esc(st.client)}` : ''}${st.skipper ? ` · skipper ${esc(st.skipper)}` : ''}${st.dep || st.ret ? `<br>Séjour : ${esc(fmtWhen(st.dep) || '?')} – ${esc(fmtWhen(st.ret) || '?')}` : ''}</td></tr>
<tr><td style="padding:14px 0 6px;font-size:16px;font-weight:bold;color:${defs.length ? '#c62f3b' : '#1b7f4b'}">${defs.length ? `${defs.length} défaut${defs.length > 1 ? 's' : ''}` : 'Aucun défaut'}</td></tr>
${defs.length ? `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${defs.map((d) => li(d.title, `${esc(d.sec)}${d.bill ? ' · <b style="color:#6b3fb4">À refacturer</b>' : ''}`, '#c62f3b')).join('')}</table></td></tr>` : ''}
${client.length ? `<tr><td style="padding:10px 0 6px;font-size:16px;font-weight:bold;color:#0c2b3d">Observations du client et autre</td></tr><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${client.map((o) => li(o.title, o.blocked ? '<b style="color:#c62f3b">Bloquante</b>' : '', '#a15c00')).join('')}</table></td></tr>` : ''}
<tr><td style="padding:14px 0 4px;color:#5d6f7c;font-size:14px">La feuille complète est en pièce jointe (PDF).</td></tr>
<tr><td style="padding:10px 0 4px"><a href="${esc(link)}" style="display:inline-block;background:#e5521f;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:9px">Ouvrir dans Hublot</a></td></tr>
<tr><td style="padding-top:18px;color:#8a9aa6;font-size:12px">Envoyé automatiquement par Hublot · ACM Caraïbes</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Feuille retour ${boat.name}`, `Validée le ${fmtWhen(r.at, { year: true })}${r.by ? ` par ${r.by}` : ''}`, st.dossier ? `Dossier ${st.dossier}` : '', '',
    defs.length ? `${defs.length} défaut(s) :` : 'Aucun défaut', ...defs.map((d) => `- ${d.title}${d.bill ? ' (à refacturer)' : ''}`),
    ...(client.length ? ['', 'Observations du client et autre :', ...client.map((o) => `- ${o.title}`)] : []), '', `Ouvrir dans Hublot : ${link}`].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  return { subject, html, text, attachment: { name: sheetFileName(boat.name, r), content: sheetPdf(boat.name, r).toString('base64') } };
}

/** Envoi par l'API de Brevo. */
export async function brevoSend(cfg, { to, subject, html, text, attachment }, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': cfg.key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: cfg.fromName, email: cfg.from }, ...(cfg.replyTo ? { replyTo: { email: cfg.replyTo } } : {}), to: to.map((email) => ({ email })), subject, htmlContent: html, textContent: text, ...(attachment ? { attachment: [attachment] } : {}) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) { let m = ''; try { m = (await res.json()).message || ''; } catch { /* */ } throw new Error(`Brevo ${res.status}${m ? ` : ${m}` : ''}`); }
  return true;
}

/** Envoie ce qui attend dans la file. Ne fait rien tant que Brevo ou les destinataires ne sont pas réglés. */
let busy = false;
export async function processMail(db, { cfg = mailConfig(), fetchImpl = fetch, journal = () => {} } = {}) {
  if (busy) return 0;
  const { to } = mailSettings(db);
  if (!cfg.key || !cfg.from || !to.length) return 0;
  busy = true;
  let sent = 0;
  try {
    const rows = db.prepare("SELECT * FROM mail_queue WHERE status = 'wait' AND next_at <= ? ORDER BY id LIMIT 10").all(new Date().toISOString());
    for (const q of rows) {
      const row = db.prepare('SELECT data FROM boats WHERE id = ? AND deleted = 0').get(q.boat_id);
      const boat = row ? JSON.parse(row.data) : null;
      const r = boat && (boat.returnSheets || []).find((x) => x.id === q.sheet_id);
      if (!r) { db.prepare("UPDATE mail_queue SET status = 'gone' WHERE id = ?").run(q.id); continue; }
      try {
        await brevoSend(cfg, { to, ...sheetMail(boat, r, cfg) }, fetchImpl);
        db.prepare("UPDATE mail_queue SET status = 'sent', sent_at = ?, tries = tries + 1, error = NULL WHERE id = ?").run(new Date().toISOString(), q.id);
        journal(boat, 'mail', 'Feuille retour envoyée par e-mail', to.join(', '));
        sent++;
      } catch (e) {
        const tries = q.tries + 1, wait = RETRY_MIN[tries - 1];
        if (wait == null) {
          db.prepare("UPDATE mail_queue SET status = 'failed', tries = ?, error = ? WHERE id = ?").run(tries, e.message, q.id);
          journal(boat, 'mailfail', 'E-mail de la feuille retour en échec', e.message);
        } else {
          db.prepare('UPDATE mail_queue SET tries = ?, error = ?, next_at = ? WHERE id = ?').run(tries, e.message, new Date(Date.now() + wait * 60e3).toISOString(), q.id);
          if (tries === 1) journal(boat, 'mailfail', 'E-mail de la feuille retour : nouvel essai prévu', e.message);
        }
      }
    }
  } finally { busy = false; }
  return sent;
}

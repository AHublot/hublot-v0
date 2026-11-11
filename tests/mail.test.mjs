import test from 'node:test';
import assert from 'node:assert/strict';

const { openDb, applySync } = await import('../server/lib.js');
const { initMail, enqueueSheets, processMail, saveMailSettings, mailStatus, sheetMail } = await import('../server/mail.js');
const { sheetPdf, sheetFileName } = await import('../server/sheet-pdf.js');
const A = await import('../src/actions.js');
const M = await import('../src/model.js');
const { diffBoat } = await import('../src/merge.js');

function fleet() {
  const db = openDb(':memory:');
  initMail(db);
  const s = M.emptyState();
  A.addBoat(s, { name: 'Palomas', base: 'Martinique' });
  applySync(db, null, { boats: s.boats }, { role: 'manager', name: 'Chef' });
  return db;
}
const boatOf = (db) => JSON.parse(db.prepare('SELECT data FROM boats').get().data);
function techDoes(db, fn) {
  const s = M.normalizeState({ boats: [boatOf(db)] });
  const before = JSON.parse(JSON.stringify(s.boats[0]));
  fn(s, s.boats[0].id);
  return applySync(db, null, { patches: [{ id: before.id, ops: diffBoat(before, s.boats[0]) }] }, { role: 'tech', name: 'Léa' });
}
function validateSheet(db) {
  techDoes(db, (s, id) => A.confirmDeparture(s, id));
  techDoes(db, (s, id) => { A.startReturnSheet(s, id, 'Léa'); s.boats[0].returnDraft.stay = { dossier: 'ACM-2026-5426', client: 'Durand' }; });
  techDoes(db, (s, id) => {
    M.sheetOf(s).flatMap((x) => x.items).forEach((it) => A.setSheetValue(s, id, it.id, it.kind === 'mix' ? 'def' : 'ok'));
    const mix = M.sheetOf(s).flatMap((x) => x.items).find((it) => it.kind === 'mix'); A.setSheetNote(s, id, mix.id, '5');
    A.setSheetValue(s, id, 'cui2', 'def'); A.setSheetNote(s, id, 'cui2', 'ne refroidit plus'); A.setSheetBill(s, id, 'cui2', true);
    A.setSheetText(s, id, 'clientObs', 'Fuite au WC avant');
    A.setSheetText(s, id, 'billToday', 'Gasoil 40 L'); A.setSheetDiver(s, id, true);
  });
  return techDoes(db, (s, id) => A.validateReturnSheet(s, id, 'Léa'));
}
const cfg = { key: 'xkeysib-test', from: 'hublot@acm.test', fromName: 'Hublot', url: 'https://hublot.test/' };

test('e-mail : la feuille validée part une fois, avec le PDF nommé', async () => {
  const db = fleet();
  const r = validateSheet(db);
  assert.equal(r.sheets.length, 1);
  enqueueSheets(db, r.sheets);
  enqueueSheets(db, r.sheets); // envoi rejoué : pas de doublon
  const sent = [];
  const fetchImpl = async (url, o) => { sent.push({ url, body: JSON.parse(o.body), key: o.headers['api-key'] }); return { ok: true, status: 201, json: async () => ({}) }; };
  assert.equal(await processMail(db, { cfg, fetchImpl }), 0); // pas encore de destinataire : on attend
  saveMailSettings(db, { to: 'anthony@acm.test; bureau@acm.test' });
  const lines = [];
  assert.equal(await processMail(db, { cfg, fetchImpl, journal: (b, k, w) => lines.push(k) }), 1);
  assert.equal(await processMail(db, { cfg, fetchImpl }), 0);
  assert.equal(sent.length, 1);
  const m = sent[0].body;
  assert.equal(sent[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(sent[0].key, 'xkeysib-test');
  assert.deepEqual(m.to.map((x) => x.email), ['anthony@acm.test', 'bureau@acm.test']);
  assert.match(m.subject, /Feuille retour · Palomas · dossier 5426 · 2 défauts/);
  assert.match(m.attachment[0].name, /^Feuille retour - Palomas - \d{2}-\d{2}-\d{4}\.pdf$/);
  assert.match(Buffer.from(m.attachment[0].content, 'base64').subarray(0, 8).toString(), /^%PDF-1\.4/);
  assert.match(m.htmlContent, /Frigo : ne refroidit plus/);
  assert.match(m.htmlContent, /Fuite au WC avant/);
  assert.match(m.htmlContent, /BUREAU<\/div>[\s\S]*Gasoil 40 L[\s\S]*Plongeur passé : <b[^>]*>OUI/);
  assert.deepEqual(lines, ['mail']);
  assert.equal(mailStatus(db)[0].status, 'sent');
});

test('e-mail : en cas d’échec, nouvel essai plus tard ; adresses vérifiées', async () => {
  const db = fleet();
  enqueueSheets(db, validateSheet(db).sheets);
  saveMailSettings(db, { to: ['anthony@acm.test'] });
  const fail = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Key not found' }) });
  assert.equal(await processMail(db, { cfg, fetchImpl: fail }), 0);
  const st = mailStatus(db)[0];
  assert.equal(st.status, 'wait');
  assert.match(st.error, /Brevo 401 : Key not found/);
  assert.throws(() => saveMailSettings(db, { to: 'pas-une-adresse' }), /Adresse invalide/);
});

test('PDF : accents, plusieurs pages, nom du fichier', () => {
  const db = fleet();
  validateSheet(db);
  const b = boatOf(db), r = b.returnSheets[0];
  const pdf = sheetPdf('Ter’happy', r).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /%%EOF\n$/);
  assert.match(pdf, /\/Count [12] /);
  assert.ok(pdf.includes('Ter\\222happy')); // apostrophe typographique en WinAnsi
  assert.equal(sheetFileName('Isla / Madinina', { at: '2026-11-10T14:30:00Z' }), 'Feuille retour - Isla Madinina - 10-11-2026.pdf');
  assert.match(sheetMail(b, r, cfg).html, /#\/retour\//);
});

// Outil d'administration en ligne de commande.
//   node server/cli.js add-user <email> [--name Prénom] [--role manager|tech]
//   node server/cli.js passwd <email>
//   node server/cli.js list
//   node server/cli.js disable <email> | enable <email>
//   node server/cli.js import <sauvegarde.json>
//   node server/cli.js backup
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { openDb, addUser, setPassword, importBackup, backup, audit } from './lib.js';

const [cmd, arg, ...rest] = process.argv.slice(2);
const opt = (k, d = '') => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : d; };

/** Saisie masquée (le mot de passe ne s'affiche pas). Accepte aussi une entrée redirigée. */
function ask(q, hidden = true) {
  return new Promise((ok) => {
    if (!process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin });
      rl.once('line', (l) => { rl.close(); ok(l); });
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(q); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); ok(a); });
  });
}
async function newPassword() {
  if (process.env.CAPDEPART_PASSWORD) return process.env.CAPDEPART_PASSWORD;
  const a = await ask('Mot de passe (10 caractères minimum) : ');
  if (!process.stdin.isTTY) return a;
  const b = await ask('Confirme le mot de passe : ');
  if (a !== b) throw new Error('Les deux saisies sont différentes.');
  return a;
}

const db = openDb();
try {
  switch (cmd) {
    case 'add-user': {
      if (!arg) throw new Error('Indique l’e-mail : add-user ton@email.fr --name Prénom');
      const u = addUser(db, { email: arg, name: opt('name'), role: opt('role', 'manager'), password: await newPassword() });
      audit(db, null, 'add-user', `${u.email} ${u.role}`);
      console.log(`Compte créé : ${u.email} (${u.role === 'manager' ? 'manager' : 'technicien'}).`);
      break;
    }
    case 'passwd': {
      setPassword(db, arg, await newPassword());
      console.log('Mot de passe changé. Les sessions ouvertes de ce compte sont fermées.');
      break;
    }
    case 'list': {
      const rows = db.prepare('SELECT email, name, role, disabled, last_login FROM users ORDER BY role, email').all();
      if (!rows.length) console.log('Aucun compte.');
      rows.forEach((r) => console.log(`${r.disabled ? '✗' : '✓'} ${r.email.padEnd(32)} ${r.role.padEnd(8)} ${r.name || ''}${r.last_login ? '  · dernière connexion ' + r.last_login.slice(0, 16).replace('T', ' ') : ''}`));
      break;
    }
    case 'disable': case 'enable': {
      const r = db.prepare('UPDATE users SET disabled = ? WHERE email = ?').run(cmd === 'disable' ? 1 : 0, String(arg).toLowerCase());
      if (!r.changes) throw new Error('Utilisateur introuvable.');
      if (cmd === 'disable') db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)').run(String(arg).toLowerCase());
      console.log(cmd === 'disable' ? 'Compte désactivé.' : 'Compte réactivé.');
      break;
    }
    case 'import': {
      const raw = JSON.parse(readFileSync(arg, 'utf8'));
      console.log(`Copie de sécurité : ${backup(db)}`);
      const v = importBackup(db, null, raw);
      audit(db, null, 'import', arg);
      console.log(`Sauvegarde importée (${(raw.data || raw).boats.length} bateaux, version ${v}).`);
      break;
    }
    case 'backup': console.log(`Copie enregistrée : ${backup(db)}`); break;
    default:
      console.log('Commandes : add-user <email> [--name Prénom] [--role manager|tech] · passwd <email> · list · disable <email> · enable <email> · import <fichier.json> · backup');
  }
} catch (e) {
  console.error('Erreur :', e.message);
  process.exitCode = 1;
} finally { db.close(); }

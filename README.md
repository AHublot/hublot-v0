# Cap Départ

Application web de préparation des départs et retours pour une flotte de location de bateaux : vue d'ensemble avec compte à rebours, une page par bateau (préparation, observations, entretiens, archives), équipe, liste avant départ de toute la flotte, sauvegardes.

Site statique, **sans build ni dépendance** (modules ES). Les données restent dans le navigateur (`localStorage`).

## Lancer en local

```bash
npm start          # http://localhost:8080
npm test           # tests de la logique métier (Node 18+)
```

## Déployer sur GitHub Pages

1. Pousser le dépôt sur GitHub (branche `main`).
2. *Settings → Pages → Source : GitHub Actions*.
3. Chaque push sur `main` lance les tests puis publie (`.github/workflows/pages.yml`).

## Données

- Stockage local (`capdepart:v2`), copies automatiques (12 h et avant import/restauration), annulation (Ctrl+Z / bouton) sur les 30 dernières actions.
- **Export / import** JSON au format d'origine `cap-depart-backup` : une ancienne sauvegarde s'importe telle quelle.
- **Export des observations** (CSV Excel) par bateau, statut et période, pour la refacturation aux propriétaires.
- Ne versionne jamais tes sauvegardes réelles (le `.gitignore` les exclut).
- Limite : pas de données partagées entre appareils. Pour cela, brancher un backend (Supabase, Firebase…) en ne modifiant que `src/store.js` (`load` / `persist`).

## Fonctions

- Vue d'ensemble : prochain départ avec compte à rebours, KPI cliquables, filtres, recherche, cartes ou planning sur 21 jours.
- Page bateau : préparation (tâches habituelles + observations, une par ligne, `!` = bloquante, dictée vocale), « Nouveau retour » qui archive la préparation et garde les observations non terminées, archives centrées sur les observations, entretiens avec échéances en jours et en heures moteur, export WhatsApp.
- Équipe et affectations, liste avant départ de la flotte avec suivi par tâche.
- Palette de commandes `Ctrl+K`, thème clair/sombre, impression, PWA hors ligne.

## Structure

`src/model.js` (données et règles) · `src/actions.js` (mutations) · `src/exports.js` (export des observations) · `src/store.js` (persistance, annulation) · `src/views/*` (rendu) · `src/app.js` (contrôleur) · `tests/` · `tools/build-preview.mjs` (page unique pour prévisualisation).

# Hublot

Application web de préparation des départs et retours pour une flotte de location de bateaux : vue d'ensemble avec compte à rebours, une page par bateau (préparation, observations, entretiens, archives), équipe, liste avant départ de toute la flotte, sauvegardes.

Deux façons de l'utiliser, avec le même code, **sans build ni dépendance npm** :

- **Sur ton VPS (recommandé)** : connexion par compte, données partagées entre le manager et l'équipe, sauvegarde quotidienne. Voir « Héberger sur ton VPS ».
- **En site statique** (GitHub Pages, fichier local) : pas de connexion, les données restent dans le navigateur de l'appareil.

## Lancer en local

```bash
npm start          # http://localhost:8080
npm test           # tests (Node 22.13+)
npm run serve      # serveur complet sur http://localhost:8080 (connexion + données partagées)
```

## Héberger sur ton VPS

Hublot tourne dans son propre conteneur Docker, à côté de tes autres projets, avec son sous-domaine. Il n'écoute que sur `127.0.0.1:8090` : c'est ton proxy (Nginx, Caddy ou Traefik) qui l'expose en HTTPS.

**1. Nom de domaine** : crée un enregistrement DNS `A` pour `hublot.lemard.fr` vers l'adresse IP du VPS.

**2. Récupérer le code et lancer le conteneur**

```bash
sudo git clone https://github.com/AHublot/hublot-v0.git /opt/hublot
cd /opt/hublot
sudo mkdir -p data && sudo chown 1000:1000 data   # le conteneur écrit la base ici
sudo docker compose up -d --build
sudo docker compose logs -f                        # « Hublot écoute sur le port 8080 »
```

Si le port 8090 est déjà utilisé sur le VPS, change-le dans `docker-compose.yml` (et dans la config du proxy).

**3. Créer ton compte manager** (le mot de passe est demandé, il ne s'affiche pas, 10 caractères minimum) :

```bash
sudo docker compose exec hublot node server/cli.js add-user ton@email.fr --name Prénom
```

**4. Exposer le site en HTTPS** avec ton proxy actuel :

- **Nginx** : copie `deploy/nginx-hublot.conf`, remplace le domaine, active-le, puis `sudo certbot --nginx -d hublot.lemard.fr`.
- **Caddy** : ajoute le bloc de `deploy/Caddyfile.example` (HTTPS automatique).
- **Traefik** : ajoute les labels de `deploy/traefik-labels.example.yml` au service.

Le HTTPS est obligatoire : sans lui, les mots de passe circuleraient en clair.

**5. Importer tes données** : connecte-toi, page **Données**, « Choisir un fichier » avec ta sauvegarde `.json`, puis « Remplacer les données de toute l'équipe ». Ou en ligne de commande :

```bash
sudo docker compose cp hublot-2026-10-30.json hublot:/tmp/import.json
sudo docker compose exec hublot node server/cli.js import /tmp/import.json
```

**Mettre à jour** après une modification du code :

```bash
cd /opt/hublot && sudo git pull && sudo docker compose up -d --build
```

**Sauvegardes** : une copie de la base est faite chaque jour dans `data/backups/` (14 jours gardés), et avant chaque import. Copie ce dossier ailleurs de temps en temps.

### Comptes

```bash
sudo docker compose exec hublot node server/cli.js list                   # liste des comptes
sudo docker compose exec hublot node server/cli.js passwd ton@email.fr    # nouveau mot de passe
sudo docker compose exec hublot node server/cli.js disable email@x.fr     # bloquer un compte
sudo docker compose exec hublot node server/cli.js add-user tech@x.fr --name Julien --role tech
```

Le rôle `tech` existe déjà côté serveur mais il est en **lecture seule** pour l'instant : les droits des techniciens restent à définir. Chacun peut changer son mot de passe depuis la page Données.

### Sécurité

Les mots de passe sont chiffrés (scrypt). La session est un cookie `HttpOnly`, `SameSite=Strict`, `Secure` en HTTPS, valable 30 jours. Les tentatives sont limitées (10 par compte et 30 par adresse en 15 min). Les requêtes qui modifient les données doivent venir du site lui-même. Le site est servi avec une politique de sécurité stricte (CSP). Les données ne sont lisibles qu'après connexion, et le dossier `server/` n'est jamais servi.

### Hors ligne

L'application garde une copie sur l'appareil. Sans réseau (sur le ponton), tu continues à travailler, et les modifications partent au retour du réseau. Si deux personnes modifient le même bateau au même moment, la dernière modification envoyée l'emporte pour ce bateau.

## Déployer sur GitHub Pages (version locale, sans connexion)

1. Pousser le dépôt sur GitHub (branche `main`).
2. *Settings → Pages → Source : GitHub Actions*.
3. Chaque push sur `main` lance les tests puis publie (`.github/workflows/pages.yml`).

## Données

- Stockage local (`capdepart:v2`), copies automatiques (12 h et avant import/restauration), annulation (Ctrl+Z / bouton) sur les 30 dernières actions.
- **Export / import** JSON au format d'origine `cap-depart-backup` : une ancienne sauvegarde s'importe telle quelle.
- **Rapport mensuel Excel** des observations (mois de constat, flotte ou un bateau) : synthèse + une feuille par bateau, observations à refacturer mises en évidence (heures, matériel, refacturé au client).
- Ne versionne jamais tes sauvegardes réelles (le `.gitignore` les exclut).
- Limite : pas de données partagées entre appareils. Pour cela, brancher un backend (Supabase, Firebase…) en ne modifiant que `src/store.js` (`load` / `persist`).

## Fonctions

- Vue d'ensemble : prochain départ avec compte à rebours, KPI cliquables, filtres, recherche, cartes ou planning sur 21 jours.
- Page bateau : préparation (tâches habituelles + observations, une par ligne, `!` = bloquante, dictée vocale), « Nouveau retour » qui archive la préparation et garde les observations non terminées, archives centrées sur les observations, entretiens avec échéances en jours et en heures moteur, export WhatsApp.
- Équipe et affectations, liste avant départ de la flotte avec suivi par tâche.
- Palette de commandes `Ctrl+K`, thème clair/sombre, impression, PWA hors ligne.

## Structure

`server/` (serveur, base SQLite, comptes) · `src/remote.js` (synchronisation) · `src/model.js` (données et règles) · `src/actions.js` (mutations) · `src/report.js` (rapport mensuel) · `src/xlsx.js` (écriture Excel sans dépendance) · `src/store.js` (persistance, annulation) · `src/views/*` (rendu) · `src/app.js` (contrôleur) · `tests/` · `tools/build-preview.mjs` (page unique pour prévisualisation).

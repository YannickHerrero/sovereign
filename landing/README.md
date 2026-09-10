# Sovereign — Landing page

App de présentation indépendante de `pwa/` et du serveur Rust. HTML statique, CSS et JavaScript léger, compilés avec Vite : le contenu est lisible sans JavaScript ; seuls les onglets et la copie des commandes en dépendent.

## Développement

```sh
cd landing
pnpm install
pnpm dev
```

Ouvrir http://localhost:5174 (port distinct de la PWA).

```sh
pnpm build                  # site statique dans dist/
pnpm preview                # aperçu sur http://localhost:4174
pnpm exec playwright install chromium  # une seule fois
pnpm test:browser           # Chromium desktop + viewport mobile
```

## Régénérer les captures de la PWA

Depuis la racine du dépôt :

```sh
cd pwa
pnpm install
pnpm exec playwright install chromium  # une seule fois
pnpm screenshots:landing
```

Cette commande démarre la vraie PWA via Vite sur `127.0.0.1:4175`, puis Playwright ouvre ses routes normales. Les réponses HTTP et la connexion WebSocket sont interceptées ; seules les données et les machines sont fictives. Aucun serveur Rust, agent, secret ni modification des composants de production n’est nécessaire.

- `pwa/tests/landing/mock.ts` : machines, tâches, conversation et patches typés selon l’API de la PWA.
- `pwa/tests/landing/capture.spec.ts` : navigation réelle, vérifications du chargement et captures PNG dans `landing/public/screenshots/`.
- Conversation desktop : 1440 × 760 ; conversation mobile : 390 × 780 ; machines : 390 × 480 ; panneau diff desktop : 836 × 760, capturé directement depuis son élément DOM.
- Date, fuseau horaire et viewport fixés, animations désactivées pour la capture. Le rendu des polices système peut varier selon l’OS ; régénérer sous le même environnement Chromium pour un rendu identique.

Les quatre PNG sont versionnés : le build de la landing ne lance pas la PWA. Le hero utilise la capture mobile sur petit écran ; les captures des fonctionnalités s’ouvrent en taille réelle dans un nouvel onglet. Régénérer puis committer les images après une évolution de l’interface.

## Déploiement

Production : **https://sovereign-landing-chi.vercel.app**.

Projet Vercel : `sovereign-landing`, relié au dépôt GitHub avec `landing` comme Root Directory et Node.js 24.x. Il est distinct du projet `sovereign` qui héberge la PWA.

Pour republier via la CLI, exécuter **depuis la racine du dépôt**, pas depuis `landing/` :

```sh
vercel link --yes --project sovereign-landing --scope <votre-equipe-vercel>
vercel deploy --prod --yes --scope <votre-equipe-vercel>
```

`landing/vercel.json` fixe les commandes et le dossier de sortie. Le `.vercelignore` à la racine limite les envois CLI à la landing, sans les dépendances locales, les builds, les secrets ni les autres apps. Les fichiers `.vercel/` et `.env.local` créés par Vercel restent ignorés par Git.

Déployer `landing/` comme un projet séparé sur un hébergeur statique (Vercel, Netlify, etc.) :

- répertoire racine : `landing`
- installation : `pnpm install --frozen-lockfile`
- build : `pnpm build`
- dossier publié : `dist`

Aucune variable d’environnement, aucun backend, aucun compte utilisateur ni outil de suivi. La landing n’est pas embarquée dans le serveur et ne change pas le déploiement de la PWA.

## Contenu et visuels

- `index.html` : texte français, métadonnées, liens vers le dépôt et exemples produit. Les aperçus sont de vraies captures de la PWA avec des données fictives, pas une console connectée.
- `src/style.css` : mise en page responsive et styles.
- `src/main.js` : onglets accessibles au clavier (flèches, Début, Fin) et copie des commandes avec message de repli.
- `public/landscape.svg` et `public/favicon.svg` : illustrations originales. La direction visuelle s’inspire de Multica (paysage immersif, typographie serif, aperçu produit), sans reprendre ses images ni son identité.
- `public/fonts/` : DM Sans et Instrument Serif, issues de [Google Fonts](https://github.com/google/fonts), auto-hébergées avec leurs licences SIL Open Font License. Aucune requête vers un service de polices externe.

Les CTA mènent aux instructions réelles d’installation, pas à une inscription ou à une offre hébergée inexistante. Mettre à jour le texte et les commandes si les prérequis du produit changent.

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

## Déploiement

Déployer `landing/` comme un projet séparé sur un hébergeur statique (Vercel, Netlify, etc.) :

- répertoire racine : `landing`
- installation : `pnpm install --frozen-lockfile`
- build : `pnpm build`
- dossier publié : `dist`

Aucune variable d’environnement, aucun backend, aucun compte utilisateur ni outil de suivi. La landing n’est pas embarquée dans le serveur et ne change pas le déploiement de la PWA.

## Contenu et visuels

- `index.html` : texte français, métadonnées, liens vers le dépôt et exemples produit. Les aperçus sont des illustrations avec des données fictives, pas une console connectée.
- `src/style.css` : mise en page responsive et styles.
- `src/main.js` : onglets accessibles au clavier (flèches, Début, Fin) et copie des commandes avec message de repli.
- `public/landscape.svg` et `public/favicon.svg` : illustrations originales. La direction visuelle s’inspire de Multica (paysage immersif, typographie serif, aperçu produit), sans reprendre ses images ni son identité.
- `public/fonts/` : DM Sans et Instrument Serif, issues de [Google Fonts](https://github.com/google/fonts), auto-hébergées avec leurs licences SIL Open Font License. Aucune requête vers un service de polices externe.

Les CTA mènent aux instructions réelles d’installation, pas à une inscription ou à une offre hébergée inexistante. Mettre à jour le texte et les commandes si les prérequis du produit changent.

# Sovereign — Landing website

A standalone product website, separate from `pwa/` and the Rust server. Static HTML, shared CSS, and a small JavaScript module, built with Vite. The content, FAQ, and language navigation work without JavaScript; feature tabs and clipboard copying use JavaScript.

## Languages

- **English (default):** `/` — `index.html`
- **French:** `/fr/` — `fr/index.html`

Both are real HTML entry points, not client-side translations. They share `src/style.css`, `src/main.js`, illustrations, and fonts. Keep their section IDs and layout structure aligned; tests compare the structure and executable installation commands across languages.

The visible **EN / FR** navigation uses ordinary links and marks the current language. There is no browser-language redirect, cookie, or local-storage override: the URL determines the language, including on reload and when sharing links.

Each page has its own title, description, canonical URL, Open Graph URL and locale. Reciprocal `hreflang` links cover `en`, `fr`, and `x-default` (English). `public/sitemap.xml` lists both pages and their language alternatives; `public/robots.txt` points to it. If the production domain changes, update the canonical/alternate URLs in both HTML documents, the sitemap, and robots.txt together.

## Development

```sh
cd landing
pnpm install
pnpm dev
```

Open http://localhost:5174 or http://localhost:5174/fr/ (a different port from the PWA).

```sh
pnpm build                  # static site in dist/, including fr/index.html
pnpm preview                # preview at http://localhost:4174
pnpm exec playwright install chromium  # once
pnpm test:browser           # both languages, desktop and mobile
```

`vite.config.js` defines the two HTML inputs in multi-page mode. `vercel.json` enables trailing slashes so `/fr/` is the canonical French route. There is no SPA rewrite or locale redirect.

## Regenerate real PWA screenshots

From the repository root:

```sh
cd pwa
pnpm install
pnpm exec playwright install chromium  # once
pnpm screenshots:landing
```

This starts the real PWA with Vite on `127.0.0.1:4175`, then Playwright opens its normal routes. HTTP responses and the WebSocket connection are intercepted; only the data and machines are fictional. No Rust server, live agent, secret, or production component changes are needed.

- `pwa/tests/landing/mock.ts`: typed demo machines, tasks, conversations, and patches. English and French fixtures differ only in their display text. The PWA's own interface remains unchanged.
- `pwa/tests/landing/capture.spec.ts`: actual navigation, loading assertions, and PNG capture into `landing/public/screenshots/`.
- Files ending in `-en.png` contain English demo data. The original filenames contain French demo data.
- Desktop conversation: 1440 × 760; mobile conversation: 390 × 780; workspaces: 390 × 480; desktop diff panel: 836 × 760, captured from its actual DOM element.
- Fixed date, timezone, and viewport; animations disabled during capture. System fonts may render differently across operating systems, so use the same Chromium environment for reproducible output.

The eight PNGs are versioned: building the website does not start the PWA. The hero selects the appropriate mobile capture on small screens; feature screenshots open at full size in a new tab. Regenerate and commit the images after interface changes. The root README uses the English desktop capture.

## Deployment

Production: **https://sovereign-landing-chi.vercel.app/** (English) and **https://sovereign-landing-chi.vercel.app/fr/** (French).

The `sovereign-landing` Vercel project is connected to GitHub with `landing` as its Root Directory and Node.js 24.x. It is separate from the `sovereign` project hosting the PWA.

To deploy through the CLI, run **from the repository root**, not from `landing/`:

```sh
vercel link --yes --project sovereign-landing --scope <your-vercel-team>
vercel deploy --prod --yes --scope <your-vercel-team>
```

`landing/vercel.json` specifies the commands and output directory. The root `.vercelignore` limits CLI uploads to the website, excluding local dependencies, builds, secrets, and other apps. Vercel's `.vercel/` and `.env.local` files stay ignored by Git.

For a separate static-hosting project (Vercel, Netlify, etc.):

- Root directory: `landing`
- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm build`
- Publish directory: `dist`

No environment variables, backend, user accounts, tracking, or external font requests. The website is not embedded in the Rust server and does not change the PWA's deployment.

## Content and assets

Present Sovereign as harness-agnostic. Distinguish **available** integrations (pi and Claude Code) from **planned, unavailable** integrations (Codex and OpenCode). Tool names in screenshots or technical explanations describe an integration, not a restriction of the product to that tool.

- `index.html` and `fr/index.html`: localized content, metadata, accessibility labels, image descriptions, installation comments, and clipboard status messages (`data-success` / `data-error` on `#copy-status`). Update both when product behavior changes.
- `src/style.css`: shared responsive layout, including the language selector on mobile.
- `src/main.js`: keyboard-accessible feature tabs (arrow keys, Home, End) and command copying with a localized fallback.
- `public/landscape.svg` and `public/favicon.svg`: original illustrations. The visual direction is inspired by Multica (immersive landscape, serif typography, product previews), without copying its images or identity.
- `public/fonts/`: self-hosted DM Sans and Instrument Serif from [Google Fonts](https://github.com/google/fonts), with their SIL Open Font Licenses.

CTAs point to real installation instructions, not a nonexistent signup flow or hosted plan. Both languages link to the English README's `#build-and-installation` section. Keep examples and screenshot data fictional, and preserve the security caveats in both languages.

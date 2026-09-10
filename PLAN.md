# Sovereign : plan v1

Console mobile pour piloter des sessions pi à distance. Deux parties dans ce monorepo :

- `server/` : binaire Rust, un par machine. Gère les sessions pi, expose une API HTTP + WebSocket, sert la PWA.
- `pwa/` : interface mobile, design repris à l'identique de la maquette "Remote coding agent console".

## 1. Décisions prises

| Sujet | Décision |
|---|---|
| Topologie | Un serveur par machine. La PWA garde la liste des serveurs (nom, URL, token) en local. |
| Agent | pi uniquement, piloté via `pi --mode rpc` (JSON lines sur stdin/stdout), un process par tâche. |
| Tâche | Une session pi dont le cwd est un dossier de `~/dev`. Pas de branche dédiée. |
| Diff | Stats `+n -m` et diff complet via git sur le working tree du repo. "View PR" devient "View diff". |
| Réseau | Tailscale. HTTPS via `tailscale serve`. Auth par token statique (Bearer). |
| Voix | Transcription temps réel OpenAI Realtime, clé saisie dans la page Settings de la PWA, stockée dans le navigateur. |
| Modèle et branche | Modèle sélectionnable via le RPC pi ; branche git affichée seulement. |
| Approbations | pi est autonome. Une carte générique pour `extension_ui_request` est prévue en dernière phase, seulement si un cas réel apparaît. |
| Notifications push | Hors v1. |
| Git | Petits commits atomiques tout au long du développement. Auteur : yannick.herrero@proton.me (config locale du repo). |

## 2. Ce que pi fournit (vérifié sur pi 0.83.0)

- `pi --mode rpc` lit des commandes JSONL sur stdin et écrit réponses + événements sur stdout. Délimiteur `\n` strict.
- Commandes utiles : `prompt`, `steer`, `follow_up`, `abort`, `get_state`, `get_messages`, `get_entries`, `set_session_name`, `get_available_models`.
- Événements utiles : `agent_start`, `turn_start`, `message_update` (deltas `text_delta`, `toolcall_*`, `thinking_*`), `tool_execution_start|update|end`, `turn_end`, `agent_end`, `agent_settled`, `extension_ui_request`.
- `get_state` renvoie `sessionFile`, `sessionId`, `sessionName`, `model`, `isStreaming`.
- Sessions : fichiers JSONL v3 dans `~/.pi/agent/sessions/<cwd encodé>/`. Entrées `session` (cwd), `session_info` (name), `model_change`, `thinking_level_change`, `message` (user, assistant, toolResult) chaînées par `id`/`parentId`.
- `--session-id <uuid>` crée une session avec un id connu, `--session <path|id>` la reprend. `--name` nomme la session. Le modèle par défaut vient de `~/.pi/agent/settings.json` (actuellement openai-codex / gpt-6-astra).
- Comportement observé : pi commence souvent par un `bash` d'exploration (pwd, git status) avant d'écrire. Les outils `write` et `edit` exposent `path` dans `args`.

Choix qui en découle : les sessions restent dans le dossier par défaut de pi, donc elles apparaissent aussi dans `pi -r` sur la machine. Le serveur lit le JSONL directement pour afficher une tâche sans relancer pi, et ne lance un process que pour envoyer un prompt.

## 3. Serveur Rust

### Stack

axum, tokio, tokio-tungstenite (via axum ws), serde, serde_json, rust-embed (PWA embarquée), tracing, uuid, chrono, toml. Pas de base SQL : un fichier `tasks.json` écrit de façon atomique suffit en v1.

### Config `~/.config/sovereign/config.toml`

```toml
name = "wsl odk"          # nom affiché dans Workspaces
listen = "127.0.0.1:7777"
token = "..."             # généré avec le nouveau fichier ; un token vide est refusé
repos_root = "~/dev"
pi_bin = "pi"             # optionnel
idle_kill_secs = 600      # arrêt d'un process pi inactif
```

### Modèle de données `~/.local/share/sovereign/tasks.json`

```
Task { id, repo, cwd, session_id, session_file, title, pinned, created_at, updated_at,
       last_run: { status: settled | error | aborted, touched_files: [{ path, plus, minus }] } }
```

État calculé, jamais stocké :
- `working` : un process pi est attaché et `isStreaming`.
- `done` : dernier run settled et `touched_files` non vide.
- `no_changes` : dernier run settled, aucun fichier touché.
- `failed` : dernier run en erreur ou avorté.

### Gestion des process pi

- Un `PiProcess` par tâche, lancé à la demande (premier prompt, ou follow-up), cwd = dossier du repo, args `--mode rpc --session <file>` (ou `--session-id` à la création avec `--name`).
- Lecture stdout ligne par ligne, split sur `\n` uniquement. Corrélation commande/réponse par `id`.
- Les événements sont normalisés en événements Sovereign et diffusés sur un broadcast tokio.
- Sur `agent_settled` : calcul de `touched_files` (paths des tool calls write/edit du run, stats via `git diff --numstat -- <paths>`), mise à jour de `updated_at`, persistance.
- Arrêt du process après `idle_kill_secs` sans streaming, ou à la suppression de la tâche. `abort` envoie la commande RPC puis laisse le process vivant.
- Au démarrage du serveur : aucun process. Les tâches se rechargent depuis `tasks.json`, le transcript depuis le JSONL.

### Génération du titre

À la création d'une tâche, le serveur lance en tâche de fond `pi -p --no-session --no-tools --no-extensions --no-skills --no-context-files` avec un prompt demandant un titre court (6 mots max) à partir du premier message. Le résultat remplace le titre provisoire, est persisté, propagé au client par `task_upsert` et appliqué à la session pi via `set_session_name`. En cas d'échec le titre provisoire reste.

### Lecture du transcript (JSONL pi)

Parser qui suit la branche active : partir de la dernière entrée et remonter les `parentId`, puis inverser. Regroupement en "tours" au sens de la maquette :
- tour utilisateur : message `user`.
- tour agent : tous les messages `assistant` + `toolResult` jusqu'au prochain `user`, fusionnés. Texte = concaténation des blocs `text`, fichiers = paths des tool calls `write`/`edit` dédoublonnés, méta = horodatage du dernier message.
- les tool calls et résultats bruts ne sont pas affichés en v1 (fidèle à la maquette).

### API HTTP (préfixe `/api`, header `Authorization: Bearer <token>`)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/workspace` | nom, version, nombre de tâches working, uptime |
| GET | `/repos` | dossiers de `repos_root` : nom, est un repo git, branche courante |
| GET | `/models?repo=…` | modèles disponibles et modèle courant via un pi éphémère sans session, dans le contexte du repo |
| GET | `/tasks/:id/models` | modèles disponibles et modèle courant de la session pi |
| POST | `/tasks/:id/model` | `{ provider, id }` : change le modèle via `set_model`, refusé pendant une exécution |
| GET | `/tasks` | liste avec état, stats, pinned, updated_at |
| POST | `/tasks` | `{ repo, message, images?, model?: { provider, id } }` : crée la tâche, lance pi, envoie le prompt. Titre provisoire = début du message, puis titre généré (voir ci-dessous). |
| GET | `/tasks/:id` | détail : tours, état, modèle, branche |
| POST | `/tasks/:id/prompt` | `{ message }` : follow-up. Si pi est en train de streamer, envoyé en `follow_up` (file d'attente). |
| POST | `/tasks/:id/abort` | abort du run en cours |
| PATCH | `/tasks/:id` | `{ pinned?, title? }` (title propagé via `set_session_name` si le process tourne, sinon au prochain lancement) |
| DELETE | `/tasks/:id` | tue le process, retire la tâche, laisse le JSONL pi en place |
| GET | `/tasks/:id/diff` | diff unifié du working tree du repo, limité aux `touched_files` de la tâche, plus numstat |
| POST | `/tasks/:id/ui-response` | réponse à un `extension_ui_request` (phase 10) |
| GET | `/ws?token=` | WebSocket événements |

Réserve : deux tâches sur le même repo partagent le working tree. Le diff est filtré sur les fichiers touchés par la tâche, mais deux tâches qui modifient le même fichier se verront mutuellement.

### WebSocket (un seul canal, JSON)

Serveur vers client :
- `task_upsert { task }` et `task_removed { id }` pour la liste.
- `run_event { task_id, event }` avec `event` parmi : `agent_start`, `status { text }` (ex "Running bash…", "Editing src/x.ts…", "Thinking…"), `text_delta { delta }`, `turn_end { turn }`, `agent_settled { task }`, `error { message }`, `ui_request { ... }`.

Client vers serveur : `subscribe { task_id }` / `unsubscribe` pour ne recevoir les deltas que de la tâche ouverte. Les `task_upsert` sont toujours envoyés.

### Service de la PWA

`pwa/dist` embarqué par rust-embed et servi à la racine, fallback `index.html`. CORS ouvert (auth par token) pour qu'une PWA ouverte depuis la machine A puisse parler à la machine B. Exposition HTTPS : `tailscale serve --bg 7777`, documenté dans le README, plus une unité systemd user d'exemple.

## 4. PWA

### Stack

Svelte 5 + TypeScript + Vite + vite-plugin-pwa. Pas de librairie UI : le CSS est écrit à partir des tokens de la maquette. Petit routeur maison sur `history` (4 écrans). Tests unitaires vitest sur le mapping tours/état seulement.

### Tokens repris de la maquette

Fond `#F7F6F3`, fond extérieur `#EDEBE6`, texte `#221f1c` / `#39362f`, secondaire `#8b8880` / `#9c9990` / `#a5a29a`, accent `#2C6FBB`, vert `#2E8B57`, rouge `#C4483C`, violet `#7A5AA8`, orange `#C8863C`, noir composer `#22201c`, bulle utilisateur `#EFEDE8`. Police `"Helvetica Neue", Helvetica, system-ui`. Animations `slideIn`, `fadeUp`, `sheetUp`, `pulseDot`, `shimmerText`, `wave`. Rayons 16 / 19 / 22 / 999.

### Écrans

1. **Workspaces** (`/`) : cartes des serveurs configurés. Statut par `GET /workspace` avec timeout court, "Connected now" / "Last seen …" mémorisé en local, "N agents running" depuis le serveur. Bouton engrenage vers Settings (ajout par rapport à la maquette, même langage visuel).
2. **Tâches** (`/w/:ws`) : header retour / recherche / filtre cyclique (Tous, Working, Has changes), titre "All Workspaces" remplacé par le nom du workspace, sous-titre "Filtered · …", groupes Pinned / Today / Earlier, lignes avec point de statut (pulse si working), titre, repo, état, `+n -m`. État vide. Composer flottant "Plan, ask, build…".
3. **Chat** (`/w/:ws/t/:id`) : header retour / "repo · titre" / menu "…" (Pin, Rename, Abort, Delete). Tours utilisateur et agent comme la maquette, ligne working avec shimmer alimentée par `status`, texte streamé par `text_delta`, liste de fichiers `+n -m`. Pilule "View diff +n -m" qui ouvre une feuille plein écran avec le diff coloré par fichier. Composer "Follow up…".
4. **Settings** (`/settings`) : liste des serveurs (nom, URL, token, test de connexion), clé OpenAI pour la voix.

### Composer

- Idle : pilule "+", placeholder, micro.
- Texte : feuille montante, en-tête `repo` + branche (affichage), textarea, "+" pour joindre une image, sélecteur de modèle pi avec recherche, bouton envoyer ou micro.
- Création depuis la liste : la feuille montre un sélecteur de repo à la place de l'en-tête `repo main`. Seul ajout fonctionnel par rapport à la maquette, indispensable pour créer une tâche.
- Vocal : voir ci-dessous. Au stop, le transcript devient le brouillon en mode texte, comme la maquette.

### Voix

Connexion directe navigateur vers l'API Realtime OpenAI en WebSocket, sous-protocoles `realtime` et `openai-insecure-api-key.<clé>`, session `type: transcription`, modèle de transcription live d'OpenAI, audio PCM 16 bits 24 kHz capturé par AudioWorklet et envoyé en `input_audio_buffer.append`. Les événements `...transcription.delta` remplissent le texte bleu, `...completed` fixe le brouillon. Aucun passage par le serveur Rust, la clé ne quitte pas le téléphone sauf vers OpenAI. Nécessite HTTPS (Tailscale) pour `getUserMedia`. Le nom exact du modèle est vérifié dans la doc au moment de la phase 8.

### Persistance locale

`localStorage` : serveurs, clé OpenAI, dernier workspace ouvert, last seen par serveur.

## 5. Phases et commits

Chaque phase se termine par un état qui tourne. Commits atomiques à l'intérieur de chaque phase (un commit par brique).

État au 9 septembre 2026 : phases 0 à 9 livrées et vérifiées (tests automatisés serveur, captures d'écran headless de chaque écran, run pi de bout en bout). Phase 10 non démarrée : aucune extension pi installée n'utilise de dialogue bloquant. Reste à valider sur iPhone réel : clavier iOS, dictée vocale, installation en HTTPS via Tailscale.

| # | Phase | Livrable vérifiable |
|---|---|---|
| 0 | Scaffold monorepo : `server/` (cargo init), `pwa/` (Svelte + Vite), README, .gitignore, ce plan | `cargo build`, `pnpm build` passent |
| 1 | Serveur : config, token, axum, `GET /workspace`, `GET /repos` | curl avec token renvoie les repos de `~/dev` |
| 2 | Serveur : parser JSONL pi, store `tasks.json`, `GET /tasks`, `GET /tasks/:id` | une session pi existante importée à la main s'affiche en tours |
| 3 | Serveur : process manager pi RPC, `POST /tasks`, `/prompt`, `/abort`, WebSocket | un prompt envoyé par curl streame dans `websocat` |
| 4 | Serveur : touched_files, numstat, `GET /diff`, états calculés, PATCH / DELETE | états et stats corrects après un run |
| 5 | PWA : scaffold, tokens CSS, routeur, Settings serveurs, écran Workspaces | statut online/offline réel |
| 6 | PWA : liste des tâches, recherche, filtre, groupes, composer texte, création avec choix du repo | création d'une tâche depuis le téléphone |
| 7 | PWA : chat streamé, ligne working, fichiers, View diff, menu "…" | suivi d'un run en direct |
| 8 | PWA : voix OpenAI Realtime, clé dans Settings | transcription live sur iPhone |
| 9 | Serveur embarque la PWA, manifest PWA, doc Tailscale, unité systemd | installable depuis l'iPhone en HTTPS |
| 10 | Carte `extension_ui_request` (select / confirm / input) | uniquement si un cas réel apparaît |

## 6. Hors périmètre v1

Notifications push, création de PR, branches par tâche, affichage des tool calls bruts, pièces jointes autres que les images, multi-utilisateur, hub central.

Ajout après la v1 : le « + » du composer permet de joindre une image (JPEG, PNG, WebP ou GIF, 5 Mio maximum), avec aperçu et retrait avant envoi. L’API transmet les blocs image à pi pour les nouveaux prompts et les follow-ups ; les images sont aussi affichées dans l’historique.

## 7. Mode desktop (plan, 9 septembre 2026)

Source : "Agent Console Desktop.dc.html" dans la seconde version du zip. Fenêtre 1280×824, trois colonnes. Même palette, même typographie, même animations que le mobile. Le cadre macOS (feux tricolores, ombre de fenêtre) est un habillage de maquette et n'est pas repris : l'application web occupe tout le viewport.

### Ce que montre la maquette

**Colonne 1, barre latérale (252 px, fond `#F1EFEA`, bordure droite 1 px)**
- Section "WORKSPACES" (11 px, majuscules, espacement 0.5 px) : une ligne par machine avec point de statut, nom 13.5 px, badge bleu "N" (pilule `rgba(44,111,187,.1)`) quand des agents tournent, sous-ligne "Online · Connected now". Ligne sélectionnée : fond `rgba(0,0,0,.07)`, rayon 9 px.
- Section "FILTERS" : All tasks, Working, Needs review, Merged, chacun avec son compteur à droite. Sélection : fond `rgba(0,0,0,.06)`.
- Pied : avatar rond, e-mail, modèle courant.

**Colonne 2, liste des tâches (352 px)**
- En-tête 44 px : loupe et champ "Search tasks" sans bordure.
- Titre du workspace 17 px, sous-titre "N tasks · M running" ou "idle".
- Groupes Pinned / Today / Earlier, lignes 13.5 px avec point de statut, repo, état, `+n -m`. Ligne active : fond `rgba(0,0,0,.06)`, rayon 9 px, marge 8 px.
- État vide "No tasks match."

**Colonne 3, conversation (reste de la largeur, fond `#FBFAF8`)**
- En-tête 44 px : titre de la tâche 13.5 px, méta "repo · branche", chip "View PR +n -m" (blanc, rayon 8 px, bordure 1 px).
- Fil de discussion centré, largeur max 720 px, bulles utilisateur à 74 % max, tours agent identiques au mobile, liste de fichiers dans une carte blanche à bordure.
- Composer ancré en bas, toujours ouvert (pas de pilule idle), carte blanche rayon 14 px, largeur max 720 px : chip repo + branche, textarea 2 lignes avec placeholder "Plan, ask, build…  ⌘↵ to send", bouton "+" carré 28 px rayon 8, chip modèle, micro et envoi 30 px (envoi gris `#c9c6bd` quand vide, noir sinon). Mode vocal : transcript bleu et bouton stop noir avec timer et ondes, comme le mobile.

### Ce que la maquette ne montre pas et ce que je propose

| Besoin | Proposition |
|---|---|
| Créer une tâche | Bouton "+" dans l'en-tête de la colonne 2 (à droite de la recherche). Il vide la sélection : le panneau droit affiche "New task", le chip repo du composer devient un sélecteur, l'envoi crée la tâche puis la sélectionne. |
| Épingler, renommer, arrêter, supprimer | Bouton "…" dans l'en-tête de la colonne 3, même menu que le mobile. |
| Diff | Le chip "View diff" ouvre un panneau latéral droit de 520 px qui glisse par-dessus la conversation (fond `#F7F6F3`, bordure gauche), fermé par Échap ou la croix. Même rendu de patch que la feuille mobile. |
| Settings | Entrée "Settings" en pied de barre latérale (remplace l'e-mail : l'application n'a pas de compte). Le contenu s'affiche dans la colonne 3, centré, largeur max 720 px. Le modèle courant reste affiché sous l'entrée. |
| Aucune machine configurée | Colonne 3 affiche une invitation à ouvrir Settings. |
| Raccourcis | ⌘↵ ou Ctrl↵ envoie (déjà en place), Échap ferme le diff ou le menu. Pas de navigation clavier dans la liste en v1. |
| Filtres | Mêmes filtres que le mobile (All tasks, Working, Has changes, Failed) avec compteurs. "Needs review" et "Merged" de la maquette n'existent pas dans l'application. |

### Bascule mobile / desktop

- Point de rupture unique : largeur de viewport ≥ 960 px et (pointeur fin ou orientation paysage) → desktop, ce qui inclut un iPad en paysage. En dessous, l'interface mobile actuelle, inchangée.
- Détection par `matchMedia` dans un petit store `layout.svelte.ts`, réévaluée au redimensionnement. Pas de choix manuel en v1.
- Mêmes routes dans les deux modes. En desktop, `/` sélectionne le premier workspace, `/w/:ws` affiche la liste sans tâche active, `/w/:ws/t/:id` sélectionne la tâche, `/settings` affiche Settings dans la colonne 3. La barre latérale et la colonne 2 restent montées quelle que soit la route : l'état (recherche, filtre, scroll) survit à la navigation.

### Réutilisation et découpage

Le mobile et le desktop partagent toute la logique ; seule la mise en page diffère. Pour ne pas dupliquer les 500 lignes de `Chat.svelte` et les 450 de `Composer.svelte`, trois extractions préalables :

1. `lib/chat.svelte.ts` : classe `ChatSession` (chargement du détail, tours, état live, gestion des événements, envoi, diff, épingler, renommer, arrêter, supprimer). `Chat.svelte` mobile ne garde que le rendu.
2. `components/Thread.svelte` : rendu de la liste des tours, du tour live et des fichiers (avec le repli à trois entrées), paramétré par une classe CSS de variante (`mobile` / `desktop`) pour les tailles de police et la largeur des bulles.
3. `lib/composer.svelte.ts` : classe `ComposerState` (brouillon, images jointes, collage, voix, envoi). `Composer.svelte` mobile la consomme ; un nouveau `DockedComposer.svelte` desktop la consomme aussi.
4. `lib/presence.svelte.ts` : sondage des machines (`GET /workspace` toutes les 15 s, last seen), aujourd'hui dans `Workspaces.svelte`, partagé avec la barre latérale.

Nouveaux fichiers desktop :

- `screens/desktop/Shell.svelte` : grille trois colonnes.
- `screens/desktop/Sidebar.svelte` : workspaces, filtres avec compteurs, pied avec Settings et modèle.
- `screens/desktop/TaskList.svelte` : recherche, titre, groupes, bouton nouvelle tâche.
- `screens/desktop/TaskPane.svelte` : en-tête, `Thread`, `DockedComposer`, menu, état "New task" et état vide.
- `screens/desktop/DiffPanel.svelte` : panneau latéral, réutilise le rendu de patch extrait de `DiffSheet.svelte` dans `components/Patch.svelte`.
- `lib/layout.svelte.ts`.

`App.svelte` choisit `Shell` ou les écrans mobiles selon `layout`. Les stores par workspace sont déjà comptés par référence : la barre latérale prend une référence sur chaque workspace configuré pour recevoir les compteurs "N running" en direct.

### Phases

| # | Phase | Livrable vérifiable |
|---|---|---|
| D0 | Extractions `ChatSession`, `Thread`, `ComposerState`, `presence`, `Patch` sans changement visible côté mobile | captures mobile identiques avant / après, `pnpm check` vert |
| D1 | `layout` store, `Shell` trois colonnes vides, bascule au point de rupture | grille visible à 1280 px, mobile intact à 402 px |
| D2 | Barre latérale : workspaces avec présence et badges, filtres avec compteurs, pied Settings | sélection d'un workspace change la colonne 2 |
| D3 | Liste des tâches : recherche, groupes, sélection, bouton nouvelle tâche | ouverture d'une tâche met à jour l'URL et la colonne 3 |
| D4 | Panneau tâche : en-tête, fil, composer ancré texte + voix, création et follow-up | run pi suivi en direct depuis le desktop |
| D5 | Menu "…", panneau diff, Settings dans la colonne 3, raccourcis Échap | diff consultable, tâche renommée depuis le desktop |
| D6 | Captures de contrôle à 1280 et 1600 px, redéploiement Vercel | maquette et rendu côte à côte |

Estimation : D0 est la phase la plus risquée (refactor du mobile), les autres sont additives.

État au 9 septembre 2026 : D0 à D6 livrées. Mobile vérifié identique au pixel près avant et après D0 (cinq écrans). Desktop vérifié à 1280×824 en headless : liste, tâche ouverte, nouvelle tâche, diff, settings, et un run pi créé depuis le composer ancré avec ⌘↵. Déployé sur Vercel.

## 8. Compatibilité Claude Code (plan, 10 septembre 2026)

Objectif : une tâche Sovereign peut être exécutée par pi ou par Claude Code, au choix au moment de la création, avec un sélecteur de modèles groupés par fournisseur.

### Faisabilité : élevée, vérifiée sur Claude Code 2.1.267 installé sur cette machine

Tests réalisés en ligne de commande depuis un dépôt bac à sable :

| Besoin | Résultat |
|---|---|
| Process persistant multi-tours | `claude -p --input-format stream-json --output-format stream-json --verbose` reste vivant, accepte plusieurs messages `user` sur stdin, émet un `result` à la fin de chaque tour. Équivalent du mode RPC de pi. |
| Streaming des deltas | `--include-partial-messages` émet des `stream_event` (`content_block_delta`), les messages `assistant` complets et les `user` de résultats d'outils. |
| Identifiant de session choisi | `--session-id <uuid>` à la création, `--resume <uuid>` ensuite depuis le même cwd : l'historique est retrouvé (test : Claude a cité le premier message après reprise dans un nouveau process). |
| Changement de modèle en session | `{"type":"control_request","request_id":"r1","request":{"subtype":"set_model","model":"sonnet"}}` répond `success` et un nouveau `system/init` porte le modèle effectif. |
| Images | Bloc `{"type":"image","source":{"type":"base64","media_type":"image/png","data":"…"}}` dans le contenu du message utilisateur : Claude a identifié la couleur. |
| Modèle courant | `system/init` expose `model` (identifiant complet), `session_id`, `permissionMode`, `apiKeySource` (`none` ici : connexion OAuth de l'abonnement). |
| Fichiers de session | `~/.claude/projects/<cwd encodé>/<session-id>.jsonl`, cwd encodé en remplaçant les non alphanumériques par `-`. Entrées `user` et `assistant` avec `message.content` en blocs (`text`, `thinking`, `tool_use` avec `name` Bash/Edit/Write et `input.file_path`, `tool_result`), chaînées par `uuid`/`parentUuid`. Entrée `ai-title` générée automatiquement par Claude Code. |
| Demandes de permission | Avec `--permission-prompt-tool stdio` et un `control_request` `initialize` envoyé au démarrage, une action non autorisée arrive sur stdout en `control_request` `can_use_tool` (outil, entrée, suggestions de règles). Sans ce flag, tout ce qui demanderait une confirmation est refusé automatiquement. Non utilisé : Claude Code tourne en `bypassPermissions`, 100 % autonome comme pi. |
| Questions (AskUserQuestion) | Sans outil de prompt, l'outil est retiré du contexte : Claude ne peut pas poser de QCM et formule ses questions en texte en fin de tour. Avec l'outil de prompt stdio, l'outil est disponible et appelé, mais aucune requête n'est émise sur stdout et le process attend indéfiniment (testé en modes bypass, manual et acceptEdits, avec et sans poignée de main `initialize`, journal de debug à l'appui). La documentation dit pourtant que la question doit remonter comme une permission. Comportement de la version 2.1.267 à considérer comme bloquant pour l'instant. |
| Liste des modèles | Aucune commande ni message ne liste les modèles disponibles. Alias documentés : `default`, `best`, `fable`, `opus`, `sonnet`, `haiku`, identifiants complets, suffixe `[1m]` pour le contexte étendu. La liste sera déclarée côté serveur. |

Points restants à vérifier en début de chantier, sans risque pour la faisabilité : forme exacte de la réponse `control_response` à `can_use_tool` (`behavior: allow | deny`), comportement d'un message `user` envoyé pendant qu'un tour est en cours (file d'attente ou rejet), et `control_request` `interrupt` pour l'arrêt.

Réserves connues :
- Le protocole stream-json et le format des fichiers de session sont qualifiés d'internes par la documentation et peuvent changer entre versions. Parade : un script `claude` factice dans `server/tests/fixtures`, comme pour pi, et des tests qui verrouillent les formes utilisées.
- Chaque machine doit avoir Claude Code connecté (`claude` fonctionne dans un terminal). Le mode `--bare` n'est pas utilisable : il désactive l'authentification OAuth.
- Les hooks et le CLAUDE.md global de l'utilisateur s'appliquent aux runs Claude Code. Comportement différent de pi : par exemple Claude Code ne commite pas de lui-même.

### Architecture : un trait de backend dans le serveur

Aujourd'hui `pi/manager.rs` mélange la gestion des tâches (baseline git, tours, diffusion WebSocket) et le décodage des événements pi. Le chantier sépare les deux.

```
trait Backend {
    fn kind(&self) -> AgentKind;                       // pi | claude
    async fn spawn(&self, task: &Task, model: Option<&ModelRef>) -> Result<Box<dyn AgentProcess>>;
    fn session_file(&self, task: &Task) -> Option<PathBuf>;
    fn read_transcript(&self, path: &Path) -> Result<Session>;   // tours normalisés
    async fn list_models(&self, cwd: &Path) -> Result<Vec<ProviderModels>>;
    async fn generate_title(&self, message: &str) -> Result<String>;
}

trait AgentProcess {
    async fn prompt(&self, message: &str, images: &[ImageContent], queued: bool) -> Result<()>;
    async fn abort(&self) -> Result<()>;
    async fn set_model(&self, model: &ModelRef) -> Result<Model>;
    async fn set_name(&self, name: &str) -> Result<()>;
    async fn answer(&self, request_id: &str, answer: Value) -> Result<()>;  // permissions et questions
    async fn kill(&self);
}

enum RunSignal {   // ce que le manager consomme, quel que soit le backend
    Start, Status(String), TextDelta(String), ToolStart { name, path }, ToolEnd,
    AssistantText { text, at, status }, Settled, Error(String),
    Request { id, kind: Permission | Question, payload }, ModelChanged(Model),
}
```

- `pi/adapter.rs` : traduit les événements RPC actuels en `RunSignal` (déplacement du `handle` existant, sans changement de comportement).
- `claude/adapter.rs` : `system/init` → `ModelChanged` et enregistrement du modèle ; `stream_event` `content_block_delta` de type `text_delta` → `TextDelta` ; `assistant` avec `tool_use` → `ToolStart` (Bash → "Running a command…", Edit/Write → "Editing/Writing <file_path>…", Read → "Reading…") ; `assistant` avec `text` → `AssistantText` ; `result` → `Settled` (ou `Error` si `is_error`) ; `control_request` `can_use_tool` → `Request::Permission`.
- `claude/session.rs` : lecteur du JSONL de Claude Code produisant les mêmes `Turn` que le lecteur pi (chaînage `parentUuid`, regroupement utilisateur / agent, fichiers touchés via `Edit`/`Write`). Le titre `ai-title` est ignoré : Sovereign garde son propre titre.
- `claude/models.rs` : liste statique déclarée dans la config, modèle courant lu dans `init`.
- Le manager (`Agents`) devient indépendant du backend : baseline git, tours, `touched_files`, arrêt après inactivité et WebSocket restent identiques. Les fichiers touchés viennent déjà de git, donc rien à adapter.

### Données et API

- `Task.agent: "pi" | "claude"`, absent = `pi` pour les tâches existantes. `Task.session_file` est renseigné à la création pour Claude Code à partir du cwd encodé.
- Config :

```toml
[claude]
bin = "claude"
models = ["fable", "opus", "sonnet", "haiku", "claude-fable-5-1[1m]"]
```

Décisions prises le 10 septembre 2026 : Claude Code tourne toujours en `--permission-mode bypassPermissions`, sans outil de prompt, donc sans aucune demande de permission. La liste de modèles Claude vient de la config serveur. Le sélecteur affiche tous les modèles à plat avec un tag de fournisseur, pas de groupes.

- `GET /models?repo=…` renvoie une liste à plat : `{ models: [{ agent, provider, id, name, input }], current }`. Pour pi, `provider` vient de son registre (`openai-codex`, `my-local-vllm`, …) ; pour Claude Code, `provider` vaut `anthropic` et `agent` vaut `claude`. Le tag affiché combine les deux quand c'est utile ("pi · openai-codex", "Claude Code").
- `POST /tasks` accepte `model: { agent, provider, id }` ; l'agent de la tâche découle du modèle choisi (défaut : pi avec son modèle par défaut). `GET /tasks/:id/models` ne renvoie que les fournisseurs du backend de la tâche : on ne change pas d'agent en cours de tâche.
- `POST /tasks/:id/ui-response` devient la réponse générique aux `Request` (permission Claude Code, question d'extension pi).
- `GET /workspace` ajoute `agents: ["pi", "claude"]` selon les binaires trouvés et connectés, pour que la PWA n'affiche que ce qui marche sur la machine.

### PWA

- Sélecteur de modèles à plat : une ligne par modèle avec le nom et un tag de fournisseur (pilule discrète : "openai-codex", "vllm", "Claude Code"), recherche conservée, modèle courant marqué. Sur une nouvelle tâche, choisir un modèle tagué Claude Code crée une tâche Claude Code. Sur une tâche existante, seuls les modèles de son backend sont proposés.
- Chip du composer : "gpt-6-astra" devient "pi · gpt-6-astra" ou "Claude · sonnet". Ligne méta des tâches : ajout de l'agent quand ce n'est pas pi.
- Questions de l'agent, famille de cartes dans le fil, rendues par le même composant quel que soit le backend : choix unique, choix multiple, confirmation oui / non, saisie libre courte, saisie longue. Plusieurs questions dans une même demande s'enchaînent dans la carte avec un en-tête court par question, et un champ "Autre" libre accompagne les QCM. Utilisée dès la v1 pour les requêtes d'extension pi (`select`, `confirm`, `input`, `editor`), et prête pour AskUserQuestion le jour où Claude Code transmet la question sur stdio (format documenté : `questions[]` avec `question`, `header`, `options[{label, description}]`, `multiSelect` ; réponse `behavior: allow` avec `updatedInput.answers` indexé par texte de question). En attendant, Claude Code pose ses questions en texte et l'utilisateur répond par un follow-up.
- Titre : par backend, `pi -p` ou `claude -p --model haiku --no-session-persistence`, avec le titre provisoire en repli.

### Phases

| # | Phase | Livrable vérifiable |
|---|---|---|
| C0 | Trait `Backend` / `AgentProcess` / `RunSignal`, adaptateur pi extrait du manager, tests existants verts, comportement pi inchangé | run pi de bout en bout identique, `cargo test` vert |
| C1 | `claude/process.rs` (spawn, JSONL, `initialize`, corrélation `control_response`), `claude/adapter.rs`, fixture `claude` factice | test d'intégration : prompt, deltas, settled avec le faux binaire |
| C2 | `claude/session.rs`, `Task.agent`, création de tâche Claude, `session_file` calculé, reprise après redémarrage du serveur | tâche Claude créée par curl, transcript relu à froid |
| C3 | Modèles groupés par agent et fournisseur, config `[claude]`, `set_model`, sélection à la création | `GET /models` renvoie les deux agents, changement de modèle en session vérifié |
| C4 | Cartes de questions génériques (choix unique, multiple, confirmation, saisie) branchées sur les requêtes d'extension pi via `ui-response`. Spike limité à deux heures pour faire remonter AskUserQuestion de Claude Code sur stdio (comparer avec ce que fait l'Agent SDK TypeScript) ; si concluant, branchement de la même carte | question pi → carte → réponse reçue par l'extension |
| C5 | PWA : sélecteur groupé, badge agent, carte de demande, chip composer | captures mobile et desktop, run Claude Code suivi depuis la PWA |
| C6 | Titre par backend, README, redéploiement Vercel et Rebuild Citadel | |

Ordre de grandeur : serveur 800 à 1 000 lignes de Rust (dont 250 de déplacement pur en C0), PWA 250 à 300 lignes. C0 est la phase à risque puisqu'elle touche le chemin pi en production ; elle se vérifie avec le test de bout en bout existant. C4 côté Claude Code dépend d'un comportement non reproduit sur la version installée ; le reste du chantier n'en dépend pas.

État au 10 septembre 2026 : C0 à C6 livrées. Vérifié : comportement pi inchangé (test de bout en bout), tâche Claude Code créée avec un modèle choisi, streaming, stats, diff, transcript relu à froid, changement de modèle en session, liste de modèles à plat taguée par agent et fournisseur, cartes de questions (choix, confirmation, saisie) pilotées par une extension pi réelle. Le spike AskUserQuestion côté Claude Code reste ouvert : le mécanisme est câblé (normalisation et réponse `updatedInput.answers`) mais la CLI 2.1.267 n'émet pas la requête.

## 9. Confort d'usage : frappe directe, groupement par projet, vue diff avancée (plan, 10 septembre 2026)

Trois chantiers indépendants, du plus petit au plus gros. Aucun ne touche le mobile téléphone, sauf le groupement par projet qui s'y applique aussi.

### F1. Taper pour écrire sans focaliser le composer

Comportement : sur un panneau de tâche (desktop et iPad avec clavier), une frappe de caractère hors de tout champ focalise le composer et y insère le caractère. Le collage (Ctrl+V ou ⌘V) hors champ est aussi redirigé vers le composer, images comprises.

Règles, dans l'ordre d'évaluation :
1. Ignorer si la touche n'est pas un caractère imprimable (une touche d'un seul caractère ou Espace), si Ctrl, Alt ou Cmd est enfoncé (Shift autorisé), ou si `isComposing` est vrai (saisie IME).
2. Ignorer si la cible est un champ de saisie, un textarea, un select ou un élément `contenteditable`. Couvre la recherche de la liste, les champs des cartes de questions et le sélecteur de modèles.
3. Ignorer si un `dialog` est ouvert, si le menu "…" est ouvert ou si le panneau de diff est affiché.
4. Sinon : `preventDefault`, focus du textarea du composer, insertion à la position du curseur, curseur déplacé après l'insertion. Sur une feuille mobile fermée (iPad en paysage), ouvrir la feuille d'abord.

Implémentation : un écouteur `keydown` et un `paste` posés au niveau du panneau de tâche (`TaskPane` et `Chat`), qui appellent une méthode `insert(text)` exposée par les composers via `ComposerState` (ajout d'un champ `pendingFocus` consommé par le composant qui possède le textarea). Le composer ancré et la feuille mobile partagent déjà `ComposerState`, donc une seule implémentation.

Vérification : test Playwright headless à 1280 px qui tape "hello" sans cliquer, vérifie que le textarea contient "hello" et a le focus ; second test qui ouvre le sélecteur de modèles, tape, et vérifie que le composer n'a rien reçu.

Taille : une soixantaine de lignes PWA.

### F2. Grouper les conversations par projet

Comportement : la liste des tâches propose deux regroupements, mémorisés dans le navigateur.
- "Par date" : Pinned, Today, Earlier, l'existant.
- "Par projet" : une section par repo, repliable, triée par activité la plus récente, en-tête avec le nom du repo, le nombre de tâches et un point qui pulse si une tâche y tourne. Dans une section, épinglées d'abord puis par date. État replié mémorisé par workspace et repo.

Recherche et filtres d'état s'appliquent aux deux modes. Une section vide après filtrage disparaît.

Emplacement du choix :
- Desktop : un petit segmenté "Date · Project" sous le sous-titre de la colonne des tâches.
- Mobile : le bouton filtre garde son cycle d'états ; le regroupement devient une ligne dans la barre de recherche dépliée (deux boutons), pour ne pas ajouter d'icône dans l'en-tête.

Implémentation : `lib/tasks.ts` gagne `groupByRepo(tasks, query, filter)` à côté de `group`, `Group` gagne `repo?`, `count`, `running`. Un store `lib/prefs.svelte.ts` mémorise le mode et les sections repliées. `Tasks.svelte` et `TaskList.svelte` rendent les en-têtes de section repliables.

Vérification : test unitaire vitest sur `groupByRepo` (tri, épinglées en tête, filtre), captures desktop et mobile des deux modes.

Taille : une centaine de lignes PWA, rien côté serveur.

### F3. Vue diff avancée sur grand écran

Cible : l'expérience GitHub de la capture fournie. Sur desktop la vue remplace le tiroir de 520 px et occupe tout le panneau de droite, avec un bouton retour vers la conversation ; l'URL devient `/w/:ws/t/:id/diff` pour que le retour navigateur fonctionne. Le mobile garde la feuille actuelle.

**Colonne gauche (260 px)** : arborescence des fichiers modifiés reconstruite depuis les chemins, dossiers repliables, filtre texte, stats `+n -m` par fichier, coche "Viewed" mémorisée localement par tâche et fichier, clic qui fait défiler jusqu'au fichier.

**Centre** : un bloc par fichier, en-tête collant avec chemin, stats, bouton copier le chemin et coche "Viewed" ; hunks séparés par leur en-tête `@@` ; numéros de ligne ancien et nouveau ; bascule unifié / côte à côte mémorisée ; boutons pour déplier le contexte entre deux hunks et en haut et bas de fichier ; fichiers repliés une fois cochés "Viewed".

**Données** : le patch unifié par fichier que renvoie déjà `GET /tasks/:id/diff` suffit pour les numéros de ligne (parse de `@@ -a,b +c,d @@`) et pour la vue côte à côte (alignement des suppressions et ajouts d'un même hunk). Le dépliage du contexte demande un nouvel endpoint `GET /tasks/:id/file?path=…&side=base|work` qui renvoie le contenu du fichier à la révision de base de la tâche ou dans le working tree, borné à 2 Mio et refusé pour les binaires. Le chemin est validé contre `touched_files`.

**Performance** : rendu paresseux des fichiers hors écran (un bloc replié affiche seulement son en-tête tant qu'il n'est pas visible), pas de coloration syntaxique en première étape. La coloration est une seconde étape, avec une librairie légère chargée à la demande.

Implémentation, tous nouveaux fichiers dans `pwa/src/lib/diff/` et `pwa/src/screens/desktop/diff/` :
- `lib/diff/parse.ts` : patch unifié → `{ hunks: [{ header, oldStart, newStart, lines: [{ kind: context|add|del, oldNo?, newNo?, text }] }] }`, avec tests unitaires sur des patches réels (ajout de fichier, suppression, renommage détecté par git, fichier binaire).
- `lib/diff/sideBySide.ts` : hunks → paires de lignes alignées.
- `lib/diff/tree.ts` : chemins → arbre de dossiers.
- `lib/diff/viewed.svelte.ts` : coches et mode d'affichage mémorisés.
- `screens/desktop/diff/DiffView.svelte`, `FileTree.svelte`, `FileDiff.svelte`, `HunkUnified.svelte`, `HunkSplit.svelte`.
- Serveur : `GET /tasks/:id/file` dans `api/tasks.rs`, lecture via `git show <base>:<path>` ou le working tree dans `git.rs`.

Vérification : tests unitaires du parseur et de l'alignement, capture à 1280 et 1600 px sur un diff réel à plusieurs fichiers, dépliage de contexte vérifié sur un fichier existant, mobile inchangé.

Taille : 500 à 700 lignes PWA, une cinquantaine côté serveur.

### Ordre et estimation

| # | Chantier | Livrable vérifiable |
|---|---|---|
| F1 | Frappe directe et collage redirigé | tests Playwright de frappe et de non-capture |
| F2 | Groupement par projet | test unitaire, captures des deux modes |
| F3a | Parseur, arbre, vue unifiée plein panneau avec colonne de fichiers, route `/diff` | capture sur un diff multi-fichiers |
| F3b | Côte à côte, coches Viewed, dépliage de contexte, endpoint fichier | capture côte à côte, contexte déplié |
| F3c | Coloration syntaxique à la demande | seulement si le poids du bundle reste raisonnable |

F1 et F2 se font dans la journée ; F3 est un chantier de l'ordre du desktop, à découper en deux livraisons.

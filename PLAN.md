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
| Modèle et branche | Affichage seul dans le composer (modèle courant de la session pi, branche git du repo). |
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
listen = "0.0.0.0:7777"
token = "..."             # généré au premier lancement si absent
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
| GET | `/tasks` | liste avec état, stats, pinned, updated_at |
| POST | `/tasks` | `{ repo, message }` : crée la tâche, lance pi, envoie le prompt. Titre provisoire = début du message, puis titre généré (voir ci-dessous). |
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
- Texte : feuille montante, en-tête `repo` + branche (affichage), textarea, "+" inactif, modèle (affichage), bouton envoyer ou micro.
- Création depuis la liste : la feuille montre un sélecteur de repo à la place de l'en-tête `repo main`. Seul ajout fonctionnel par rapport à la maquette, indispensable pour créer une tâche.
- Vocal : voir ci-dessous. Au stop, le transcript devient le brouillon en mode texte, comme la maquette.

### Voix

Connexion directe navigateur vers l'API Realtime OpenAI en WebSocket, sous-protocoles `realtime` et `openai-insecure-api-key.<clé>`, session `type: transcription`, modèle de transcription live d'OpenAI, audio PCM 16 bits 24 kHz capturé par AudioWorklet et envoyé en `input_audio_buffer.append`. Les événements `...transcription.delta` remplissent le texte bleu, `...completed` fixe le brouillon. Aucun passage par le serveur Rust, la clé ne quitte pas le téléphone sauf vers OpenAI. Nécessite HTTPS (Tailscale) pour `getUserMedia`. Le nom exact du modèle est vérifié dans la doc au moment de la phase 8.

### Persistance locale

`localStorage` : serveurs, clé OpenAI, dernier workspace ouvert, last seen par serveur.

## 5. Phases et commits

Chaque phase se termine par un état qui tourne. Commits atomiques à l'intérieur de chaque phase (un commit par brique).

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

Notifications push, création de PR, branches par tâche, affichage des tool calls bruts, changement de modèle, pièces jointes via "+", multi-utilisateur, hub central.

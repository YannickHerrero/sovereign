# Sovereign

Console mobile pour piloter des sessions [pi](https://github.com/badlogic/pi-mono) à distance.

- `server/` : serveur Rust, un par machine. Gère les sessions pi, expose une API HTTP + WebSocket, sert la PWA.
- `pwa/` : interface mobile (Svelte 5, Vite), embarquée dans le binaire du serveur.

Voir [PLAN.md](PLAN.md) pour l'architecture et les phases.

## Prérequis sur chaque machine

- `pi` installé et authentifié (`pi` fonctionne dans un terminal).
- Rust (cargo) pour compiler le serveur, Node + pnpm pour compiler la PWA.
- Tailscale pour l'accès depuis le téléphone.

## Build et installation

```sh
# 1. PWA (le serveur l'embarque à la compilation en release)
cd pwa
pnpm install
pnpm build

# 2. Serveur
cd ../server
cargo install --path .
```

Premier lancement : `sovereign-server` crée `~/.config/sovereign/config.toml` avec un token aléatoire.

```toml
name = "wsl odk"          # nom affiché dans l'écran Workspaces
listen = "0.0.0.0:7777"
token = "..."             # à saisir dans la PWA
repos_root = "~/dev"      # chaque sous-dossier est un repo proposé à la création d'une tâche
pi_bin = "pi"
idle_kill_secs = 600      # arrêt d'un process pi inactif
```

Les tâches sont enregistrées dans `~/.local/share/sovereign/tasks.json`. Les sessions restent dans le dossier de pi (`~/.pi/agent/sessions/`), donc visibles aussi avec `pi -r` dans le repo.

## Lancer au démarrage

```sh
cp deploy/sovereign.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sovereign
loginctl enable-linger $USER   # pour une machine sans session ouverte
```

## Exposer en HTTPS avec Tailscale

Le micro (voix) et l'installation en PWA exigent HTTPS. Tailscale fournit un certificat pour le nom de la machine :

```sh
tailscale serve --bg 7777
tailscale serve status
```

L'URL à saisir dans la PWA est alors `https://<machine>.<tailnet>.ts.net`.

## Utilisation

1. Ouvrir l'URL d'une machine sur l'iPhone, l'ajouter à l'écran d'accueil.
2. Settings : ajouter chaque machine (nom, URL, token). La PWA ouverte depuis une machine peut piloter les autres.
3. Settings : coller une clé API OpenAI pour la dictée (transcription temps réel, la clé reste dans le navigateur).
4. Workspaces : choisir une machine, puis "Plan, ask, build…" pour lancer une tâche dans un repo.
5. Dans la bulle de composition, « + » permet de joindre une image (JPEG, PNG, WebP ou GIF, 5 Mio maximum), avec ou sans texte. L’aperçu peut être retiré avant l’envoi. Le modèle pi choisi doit accepter les images.

## Développement

```sh
# serveur (config et store isolés)
cd server
SOVEREIGN_CONFIG=/tmp/sov.toml SOVEREIGN_STORE=/tmp/tasks.json cargo run

# pwa avec rechargement à chaud
cd pwa
pnpm dev
```

En debug, le serveur lit `pwa/dist` sur le disque : un `pnpm build` suffit pour rafraîchir la PWA servie.

Tests : `cargo test` dans `server/`, `pnpm check` dans `pwa/`.

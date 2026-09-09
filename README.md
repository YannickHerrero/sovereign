# Sovereign

Console mobile pour piloter des sessions [pi](https://github.com/badlogic/pi-mono) à distance.

- `server/` : serveur Rust, un par machine. Gère les sessions pi, expose une API HTTP + WebSocket, sert la PWA.
- `pwa/` : interface mobile (Svelte 5, Vite).

Voir [PLAN.md](PLAN.md) pour l'architecture et les phases.

## Développement

```sh
# serveur
cd server
cargo run

# pwa
cd pwa
pnpm install
pnpm dev
```

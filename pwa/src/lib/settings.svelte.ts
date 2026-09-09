export interface Server {
  id: string;
  name: string;
  url: string;
  token: string;
  /** Unix ms of the last successful contact, kept per browser. */
  lastSeen?: number;
}

const KEY = 'sovereign.settings.v1';

interface Persisted {
  servers: Server[];
  openaiKey: string;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return { servers: parsed.servers ?? [], openaiKey: parsed.openaiKey ?? '' };
    }
  } catch {
    // Storage unavailable or corrupt: start empty.
  }
  return { servers: [], openaiKey: '' };
}

const data = $state<Persisted>(load());

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Best effort only.
  }
}

export const settings = {
  get servers() {
    return data.servers;
  },
  get openaiKey() {
    return data.openaiKey;
  },
  set openaiKey(value: string) {
    data.openaiKey = value.trim();
    persist();
  },
  server(id: string): Server | undefined {
    return data.servers.find((s) => s.id === id);
  },
  addServer(input: Omit<Server, 'id'>): Server {
    const server: Server = { id: crypto.randomUUID(), ...input, url: normalizeUrl(input.url) };
    data.servers.push(server);
    persist();
    return server;
  },
  updateServer(id: string, patch: Partial<Omit<Server, 'id'>>) {
    const server = data.servers.find((s) => s.id === id);
    if (!server) return;
    Object.assign(server, patch, patch.url !== undefined ? { url: normalizeUrl(patch.url) } : {});
    persist();
  },
  removeServer(id: string) {
    const index = data.servers.findIndex((s) => s.id === id);
    if (index >= 0) data.servers.splice(index, 1);
    persist();
  },
};

function normalizeUrl(url: string): string {
  let value = url.trim().replace(/\/+$/, '');
  if (value && !/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value;
}

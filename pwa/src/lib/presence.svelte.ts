import { api } from './api';
import { settings, type Server } from './settings.svelte';

export interface Status {
  online: boolean;
  agents: number;
  name?: string;
}

/** Periodic reachability probe of every configured server, shared by all views. */
class Presence {
  statuses = $state<Record<string, Status>>({});
  now = $state(Date.now());

  private refCount = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private onVisible = () => document.visibilityState === 'visible' && this.refresh();

  /** Reference-counted: probing runs while at least one view holds a reference. */
  acquire(): () => void {
    if (this.refCount++ === 0) {
      this.refresh();
      this.timer = setInterval(() => this.refresh(), 15000);
      document.addEventListener('visibilitychange', this.onVisible);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.refCount === 0) {
        clearInterval(this.timer);
        document.removeEventListener('visibilitychange', this.onVisible);
      }
    };
  }

  refresh() {
    this.now = Date.now();
    for (const server of settings.servers) void this.probe(server);
  }

  status(serverId: string): Status | undefined {
    return this.statuses[serverId];
  }

  private async probe(server: Server) {
    try {
      const ws = await api.workspace(server);
      this.statuses[server.id] = { online: true, agents: ws.agents_running, name: ws.name };
      settings.updateServer(server.id, { lastSeen: Date.now() });
    } catch {
      this.statuses[server.id] = { online: false, agents: 0 };
    }
  }
}

export const presence = new Presence();

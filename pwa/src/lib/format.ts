const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "now", "5m", "3h", "2d" */
export function ago(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  return `${Math.floor(diff / DAY)}d`;
}

/** "Connected now" / "Connected 3m ago" / "Last seen yesterday, 18:42" */
export function seenLabel(online: boolean, lastSeen: number | undefined, now = Date.now()): string {
  if (online) return 'Connected now';
  if (!lastSeen) return 'Never connected';
  const diff = now - lastSeen;
  if (diff < HOUR) return `Last seen ${ago(lastSeen, now)} ago`;
  const date = new Date(lastSeen);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (isSameDay(date, new Date(now))) return `Last seen today, ${time}`;
  if (isSameDay(date, new Date(now - DAY))) return `Last seen yesterday, ${time}`;
  return `Last seen ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

/** Local time today, day/month otherwise, with a two-digit year for older years. */
export function messageTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  const pad = (value: number) => String(value).padStart(2, '0');
  if (isSameDay(date, today)) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
  return date.getFullYear() === today.getFullYear() ? day : `${day}/${pad(date.getFullYear() % 100)}`;
}

export function isToday(at: number, now = Date.now()): boolean {
  return isSameDay(new Date(at), new Date(now));
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function agentsLabel(count: number): string {
  if (count === 0) return 'No agent running';
  return count === 1 ? '1 agent running' : `${count} agents running`;
}

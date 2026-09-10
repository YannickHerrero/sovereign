import { describe, expect, it } from 'vitest';
import { messageTime } from './format';

const at = (year: number, month: number, day: number, hour = 14, minute = 32) =>
  new Date(year, month - 1, day, hour, minute).getTime();

describe('messageTime', () => {
  const now = at(2026, 9, 10);
  it('shows only local time today', () => {
    expect(messageTime(at(2026, 9, 10), now)).toBe('14:32');
    expect(messageTime(at(2026, 9, 10, 0, 5), now)).toBe('00:05');
  });
  it('shows only the date on another day', () => {
    expect(messageTime(at(2026, 9, 9), now)).toBe('09/09');
  });
  it('adds a two-digit year for another year', () => {
    expect(messageTime(at(2025, 9, 9), now)).toBe('09/09/25');
  });
  it('switches at local midnight, not after 24 hours', () => {
    const message = at(2026, 9, 10, 23, 59);
    expect(messageTime(message, message)).toBe('23:59');
    expect(messageTime(message, at(2026, 9, 11, 0, 0))).toBe('10/09');
    expect(messageTime(at(2025, 12, 31, 23, 59), at(2026, 1, 1, 0, 0))).toBe('31/12/25');
  });
});

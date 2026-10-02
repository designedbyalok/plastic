const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/** "Edited just now", "Edited 1 hour ago", "Edited 173 days ago". */
export function editedAgo(updatedAt: number, now: number): string {
  const seconds = Math.max(0, (now - updatedAt) / 1000);
  if (seconds < 60) return 'Edited just now';
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    seconds < 3600 ? [seconds / 60, 'minute'] : seconds < 86400 ? [seconds / 3600, 'hour'] : seconds < 86400 * 365 ? [seconds / 86400, 'day'] : [seconds / (86400 * 365), 'year'];
  return `Edited ${relative.format(-Math.floor(value), unit)}`;
}

/** A person's avatar: their initials (no photos yet). */
export function initials(name: string, fallback = ''): string {
  const words = (name || fallback).trim().split(/[\s._@-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function Avatar({ name, fallback, size }: { name: string; fallback?: string; size: number }) {
  return (
    <span className="home-avatar-initials" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {initials(name, fallback)}
    </span>
  );
}

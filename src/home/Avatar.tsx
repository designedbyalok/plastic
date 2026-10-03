/** A person's avatar: their photo, or their initials when there's none (or it can't load). */
import { useState } from 'react';

export function initials(name: string, fallback = ''): string {
  const words = (name || fallback).trim().split(/[\s._@-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function Avatar({ name, fallback, size, image }: { name: string; fallback?: string; size: number; image?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (image && failed !== image) {
    return (
      <img
        className="home-avatar-image"
        src={image}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        // Google-hosted photos refuse requests that carry a referrer.
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailed(image)}
      />
    );
  }
  return (
    <span className="home-avatar-initials" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {initials(name, fallback)}
    </span>
  );
}

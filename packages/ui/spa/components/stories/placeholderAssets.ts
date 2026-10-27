/**
 * Self-contained stand-ins for the placeholder image services stories used to
 * link to (`placehold.co`, `i.pravatar.cc`).
 *
 * Reaching out to the network from a story makes the story only as reliable as
 * someone else's uptime: on an offline machine, behind a corporate proxy or in
 * CI the images fail to load and every affected story renders broken-image
 * icons - and the console errors that come with them drown out the real ones.
 * These render the same kind of placeholder as an inline SVG data URL, so they
 * work anywhere and are stable enough to diff screenshots against.
 */

function toDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A labelled rectangle, the way `placehold.co/{w}x{h}/{bg}/{fg}?text=` renders
 * one. Colors are CSS colors (the service takes bare hex, so pass `#e2e8f0`).
 */
export function placeholderImage({
  width,
  height,
  text,
  bg = "#e2e8f0",
  fg = "#475569",
}: {
  width: number;
  height: number;
  text: string;
  bg?: string;
  fg?: string;
}): string {
  // Roughly what the service does: fill the box without overflowing it, so a
  // one-character label in a 64x64 avatar box still reads as a label and a
  // long one in a 600x400 box does not run off the edges.
  const fontSize = Math.max(
    8,
    Math.min(height * 0.4, (width * 1.6) / Math.max(text.length, 1)),
  );
  return toDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect width="${width}" height="${height}" fill="${bg}"/>` +
      `<text x="50%" y="50%" fill="${fg}" font-family="sans-serif" font-size="${fontSize.toFixed(
        1,
      )}" text-anchor="middle" dominant-baseline="central">${escapeXml(
        text,
      )}</text></svg>`,
  );
}

const AVATAR_COLORS = [
  "#0f766e",
  "#b45309",
  "#6d28d9",
  "#be123c",
  "#1d4ed8",
  "#4d7c0f",
];

/**
 * A deterministic avatar for `seed` (a username), replacing `i.pravatar.cc`.
 * The same seed always gets the same color, so authors stay recognisable
 * across stories.
 */
export function placeholderAvatar(seed: string, size = 150): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const bg = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  const initials = seed.slice(0, 2).toUpperCase();
  return toDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" fill="${bg}"/>` +
      `<text x="50%" y="50%" fill="#ffffff" font-family="sans-serif" font-size="${(
        size * 0.4
      ).toFixed(
        1,
      )}" text-anchor="middle" dominant-baseline="central">${escapeXml(
        initials,
      )}</text></svg>`,
  );
}

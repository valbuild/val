/**
 * This origin's `localStorage`, or `null` where there is none to use.
 *
 * Through `try`: storage can be off, or throw on access, in a private window
 * or with site data blocked -- and then the caller simply has nothing stored.
 */
export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * One entry per key, `prefix + id`, stamped with when it was written.
 *
 * One key per entry rather than one JSON value holding them all, and that is
 * the point: a shared value is read, changed and written back, and two tabs
 * doing that at once -- two presses, two builder tabs ending -- lose
 * whichever wrote first. Writing a key of one's own loses nothing.
 *
 * Entries older than `keepMs` are swept on every write, so they cannot pile
 * up; a sweep that races another only removes what both agree has expired.
 */
export function writeKeyed(
  storage: Storage,
  prefix: string,
  id: string,
  value: unknown,
  options: { now: number; keepMs: number },
): boolean {
  try {
    storage.setItem(prefix + id, JSON.stringify({ at: options.now, value }));
  } catch {
    return false;
  }
  try {
    const expired: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || !key.startsWith(prefix)) continue;
      const entry = readEntry(storage, key);
      if (entry === null || options.now - entry.at >= options.keepMs) {
        expired.push(key);
      }
    }
    for (const key of expired) storage.removeItem(key);
  } catch {
    // An entry left behind is swept by the next write.
  }
  return true;
}

/** The entry stored for `id`, or `null`. The value is the caller's to check. */
export function readKeyed(
  storage: Storage,
  prefix: string,
  id: string,
): { at: number; value: unknown } | null {
  return readEntry(storage, prefix + id);
}

function readEntry(
  storage: Storage,
  key: string,
): { at: number; value: unknown } | null {
  try {
    const raw: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("at" in raw) ||
      typeof raw.at !== "number" ||
      !("value" in raw)
    ) {
      return null;
    }
    return { at: raw.at, value: raw.value };
  } catch {
    return null;
  }
}

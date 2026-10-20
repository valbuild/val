/**
 * Read straight from a pnpm lockfile's text, with no YAML parser: what
 * `/val/adept` lists, and which TypeScript the typecheck loads.
 * `pnpmLockfile.ts` is the full reader.
 */

export type Locked = { name: string; version: string; integrity?: string };

/** The registry packages a pnpm 9 lockfile's `packages:` section names. */
export function lockedPackages(lockfile: string): Locked[] {
  const out: Locked[] = [];
  let inPackages = false;
  let current: Locked | null = null;
  for (const line of lockfile.split("\n")) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith("packages:");
      current = null;
      continue;
    }
    if (!inPackages) continue;
    const head = /^ {2}['"]?(.+?)['"]?:\s*$/.exec(line);
    if (head) {
      const key = head[1]!;
      const at = key.lastIndexOf("@");
      const version = key.slice(at + 1);
      current = null;
      if (at > 0 && /^\d+\.\d+\.\d+/.test(version)) {
        current = { name: key.slice(0, at), version };
        out.push(current);
      }
      continue;
    }
    const integrity = /integrity: (sha512-[^,}\s]+)/.exec(line);
    if (current && integrity) current.integrity = integrity[1];
  }
  return out;
}

/** The version the root importer's lockfile entry gives `typescript`. */
export function typescriptVersion(lockfile: string): string | null {
  const start = lockfile.indexOf("\n  .:\n");
  if (start < 0) return null;
  const end = lockfile.indexOf("\n\n", start + 1);
  const root = lockfile.slice(start, end < 0 ? undefined : end);
  return (
    /\n {6}typescript:\n {8}specifier: [^\n]+\n {8}version: (\d+\.\d+\.\d+[^\s(]*)/.exec(
      root,
    )?.[1] ?? null
  );
}

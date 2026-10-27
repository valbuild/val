/*
 * The git tree hash of a file record, computed the way git computes it.
 *
 * ## Why not any other hash
 *
 * The platform compares what a publisher built against what the commit it names
 * actually holds. That comparison is only useful if two honest publishers of one
 * commit agree -- and "a hash over the file record" does not give that. CI
 * hashes a checkout, a browser tab hashes its in-memory record, and they differ
 * over anything at all: a generated file, a binary the tab skipped,
 * `val.server.ts` wired at a different moment, line endings. Every instant
 * publish would then look like a divergence and be replaced by the CI build, and
 * the pointer would churn after every save.
 *
 * The tree hash removes the question rather than tightening the tolerance. It is
 * what git already stores for the commit, so CI has it for nothing and the
 * region reads it from the git host along with HEAD. Two honest builds of one
 * commit then agree BY DEFINITION, because they are both naming the same object.
 *
 * ## The format, which is small and unforgiving
 *
 * A blob is `blob <byteLength>\0<bytes>`, SHA-1'd. A tree is the concatenation
 * of `<mode> <name>\0<20 raw sha bytes>` over its entries, SHA-1'd, built
 * bottom-up. Modes are `100644`, `100755` and `40000` -- a tree's mode has no
 * leading zero inside an entry, which is the detail that silently produces a
 * hash git disagrees with.
 *
 * Entry order is where a reimplementation usually goes wrong: git sorts by name,
 * but compares a directory as though its name ended in `/`. So `foo.txt` sorts
 * BEFORE `foo/` even though `.` is below `/` in ASCII. Get that wrong and the
 * hash is stable, plausible, and not git's.
 */

/** SHA-1 over bytes, as the 20 raw bytes git concatenates into a tree. */
async function sha1(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-1", bytes as BufferSource);
  return new Uint8Array(digest);
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const utf8 = (text: string) => new TextEncoder().encode(text);

/** `blob <length>\0<content>`, hashed. The same value as `git hash-object`. */
export async function blobSha(content: Uint8Array): Promise<string> {
  return hex(await sha1(concat([utf8(`blob ${content.length}\0`), content])));
}

interface Entry {
  /** `100644`, `100755`, or `40000` for a subtree. */
  mode: string;
  name: string;
  sha: Uint8Array;
}

/**
 * The sort git uses, which is not the sort a reader expects.
 *
 * A tree entry compares as though its name had a trailing `/`. `/` is 0x2F and
 * `.` is 0x2E, so `foo.txt` comes before `foo/` -- the opposite of what plain
 * name ordering gives, and a difference that changes the hash without changing
 * anything a human would notice.
 */
function gitOrder(a: Entry, b: Entry): number {
  const an = a.mode === "40000" ? `${a.name}/` : a.name;
  const bn = b.mode === "40000" ? `${b.name}/` : b.name;
  return an < bn ? -1 : an > bn ? 1 : 0;
}

async function hashTree(entries: Entry[]): Promise<Uint8Array> {
  const sorted = [...entries].sort(gitOrder);
  const body = concat(
    sorted.flatMap((e) => [utf8(`${e.mode} ${e.name}\0`), e.sha]),
  );
  return sha1(concat([utf8(`tree ${body.length}\0`), body]));
}

/** A file, as this record holds it: its bytes and whether git marks it executable. */
export interface TreeFile {
  content: Uint8Array;
  executable?: boolean;
}

/**
 * The tree hash of a whole file record.
 *
 * Paths are `/`-separated and may or may not start with one -- a leading slash
 * is stripped, because a record keyed `/src/a.ts` and one keyed `src/a.ts` are
 * the same tree and must not hash differently.
 *
 * An empty record hashes to git's empty tree, which is a real object with a
 * well-known id rather than a special case.
 */
export async function treeSha(
  files: Record<string, TreeFile>,
): Promise<string> {
  interface Node {
    files: Map<string, TreeFile>;
    dirs: Map<string, Node>;
  }
  const root: Node = { files: new Map(), dirs: new Map() };
  for (const [rawPath, file] of Object.entries(files)) {
    const parts = rawPath.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length === 0) continue;
    const name = parts.pop()!;
    let at = root;
    for (const dir of parts) {
      let next = at.dirs.get(dir);
      if (!next) {
        next = { files: new Map(), dirs: new Map() };
        at.dirs.set(dir, next);
      }
      at = next;
    }
    at.files.set(name, file);
  }

  const build = async (node: Node): Promise<Uint8Array> => {
    const entries: Entry[] = [];
    for (const [name, file] of node.files) {
      entries.push({
        mode: file.executable ? "100755" : "100644",
        name,
        sha: await sha1(
          concat([utf8(`blob ${file.content.length}\0`), file.content]),
        ),
      });
    }
    for (const [name, dir] of node.dirs) {
      entries.push({ mode: "40000", name, sha: await build(dir) });
    }
    return hashTree(entries);
  };
  return hex(await build(root));
}

/** The common case: a record of text files, none executable. */
export function treeShaOfText(files: Record<string, string>): Promise<string> {
  const encoder = new TextEncoder();
  return treeSha(
    Object.fromEntries(
      Object.entries(files).map(([path, text]) => [
        path,
        { content: encoder.encode(text) },
      ]),
    ),
  );
}

import type { ModuleFilePath } from "@valbuild/core";
import { moduleKey, type ModuleVersion } from "@valbuild/shared/internal";

/**
 * What every surface showed, in order: a frame each time the world observes.
 * The invariants are checked against this log, so a failure can say which
 * surface broke which rule, and when.
 *
 * Since phase 1 (`docs/plans/one-content-model.md`) a frame carries, beside
 * the value, the VERSION of every module the surface read it from: which
 * source answered, the version that source carried, and the schema version
 * of the code that read it. Two frames at the same version are the same
 * content, which is what lets the invariants say more than "the values
 * agree at the end".
 */

/** What one surface read one module at, for one frame. */
export type FrameVersion = {
  /**
   * Which source answered: `studio` (the editor's store), `server-draft`
   * (Val's server, draft applied), `overlay` (what a Studio relayed to the
   * page), `bundle` (the build's own module) or `snapshot` (a content
   * version or a proposal's saves).
   */
  from: string;
  /** The version of what was shown, or `null` where the source carries none yet. */
  version: ModuleVersion | null;
  /**
   * The schema version of the code that read it: the page's own module, or
   * `null` where the reader and the content cannot differ (the Studio reads
   * with the schema it holds).
   */
  readWith: string | null;
  /** The project `seq` the surface's answer was at, where it is known. */
  seq?: number;
};

export type FrameVersions = Partial<Record<ModuleFilePath, FrameVersion>>;

export type Frame = {
  /** Which observation this was: 0, 1, 2 … */
  at: number;
  surface: string;
  value: unknown;
  /** By module: see {@link FrameVersion}. Absent where the surface reports none. */
  versions?: FrameVersions;
};

export type Frames = {
  record(surface: string, value: unknown, versions?: FrameVersions): void;
  /** Called by the world after each observation of every surface. */
  tick(): void;
  readonly all: readonly Frame[];
  of(surface: string): Frame[];
  /** The last value a surface showed. */
  last(surface: string): unknown;
  /** The version the last frame of a surface showed a module at. */
  lastVersion(
    surface: string,
    moduleFilePath: ModuleFilePath,
  ): ModuleVersion | null;
  /**
   * Every invariant: converges, never goes back, same version same value,
   * and never read with another schema. For surfaces that all show the SAME
   * thing.
   */
  expectInvariants(): void;
  /**
   * Only the invariants that hold surface by surface -- "never goes back"
   * and "never read with another schema" -- for surfaces that show
   * DIFFERENT things (two fields), which "converges" and "same version,
   * same value" do not apply to.
   */
  expectNeverGoesBack(): void;
};

export function createFrames(): Frames {
  const all: Frame[] = [];
  let at = 0;
  const of = (surface: string) => all.filter((f) => f.surface === surface);
  const fail = (problems: string[]) => {
    if (problems.length > 0) {
      throw new Error(
        `${problems.join("\n\n")}\n\nAll frames:\n${describe(all)}`,
      );
    }
  };
  return {
    record(surface, value, versions) {
      all.push({
        at,
        surface,
        value,
        ...(versions !== undefined ? { versions } : {}),
      });
    },
    tick() {
      at++;
    },
    get all() {
      return all;
    },
    of,
    last(surface) {
      return of(surface).at(-1)?.value;
    },
    lastVersion(surface, moduleFilePath) {
      return of(surface).at(-1)?.versions?.[moduleFilePath]?.version ?? null;
    },
    expectNeverGoesBack() {
      fail([...neverGoesBack(all), ...neverWithAnotherSchema(all)]);
    },
    expectInvariants() {
      fail([
        ...converges(all),
        ...neverGoesBack(all),
        ...sameVersionSameValue(all),
        ...neverWithAnotherSchema(all),
      ]);
    },
  };
}

/**
 * 1. Converges. At the end, every surface shows the same value: each
 * surface's LAST frame, wherever it was recorded. (Comparing only the frames
 * of the last observation missed a surface that stopped recording earlier --
 * a loader nothing re-ran -- which is exactly the surface that is behind.)
 * And, where the last frames carry versions, they show every module at the
 * same version: equal values at different versions are content that only
 * happens to agree.
 */
function converges(all: readonly Frame[]): string[] {
  const last = new Map<string, Frame>();
  for (const frame of all) last.set(frame.surface, frame);
  const values = new Set(
    [...last.values()].map((f) => JSON.stringify(f.value)),
  );
  if (values.size > 1) {
    return [
      `✕ converges: the surfaces disagree at the end\n${describe([...last.values()])}`,
    ];
  }
  const keys = new Map<ModuleFilePath, Set<string>>();
  for (const frame of last.values()) {
    for (const [path, read] of versionsOf(frame)) {
      if (read.version === null) continue;
      const seen = keys.get(path) ?? new Set<string>();
      seen.add(moduleKey(path, read.version));
      keys.set(path, seen);
    }
  }
  const split = [...keys].filter(([, seen]) => seen.size > 1);
  if (split.length === 0) return [];
  return [
    `✕ converges: the surfaces end on the same value at different versions of ${split
      .map(([path]) => path)
      .join(", ")}\n${describe([...last.values()])}`,
  ];
}

/**
 * 2. Never goes back. No surface shows a value, then another, then the first
 * again -- unless the content really moved on: the value comes back at a
 * version the surface has not shown before (a discard in the middle of the
 * chain gives the field its old value at a NEW chain), or at an older
 * version again after the project's `seq` moved past it (the newest patch
 * was discarded, and the chain went back).
 */
function neverGoesBack(all: readonly Frame[]): string[] {
  const problems: string[] = [];
  for (const surface of new Set(all.map((f) => f.surface))) {
    const shown: string[] = [];
    /** The versions shown so far, by the value they were shown with. */
    const shownAt = new Map<string, Frame[]>();
    let previous: Frame | null = null;
    for (const frame of all.filter((f) => f.surface === surface)) {
      const value = JSON.stringify(frame.value);
      if (shown.at(-1) === value) {
        previous = frame;
        continue;
      }
      if (shown.includes(value) && !movedOn(frame, previous, shownAt)) {
        problems.push(
          `✕ never goes back: "${surface}" showed ${value} again at ${frame.at}, after ${shown.at(-1)}`,
        );
        break;
      }
      shown.push(value);
      shownAt.set(value, [...(shownAt.get(value) ?? []), frame]);
      previous = frame;
    }
  }
  return problems;
}

/**
 * Whether a value shown again is the content moving on rather than back: a
 * module it was read from is at a version this value was not shown at
 * before, or at the same one again with the frame's `seq` past the one the
 * surface showed last.
 */
function movedOn(
  frame: Frame,
  previous: Frame | null,
  shownAt: Map<string, Frame[]>,
): boolean {
  const versions = versionsOf(frame);
  if (versions.length === 0) return false;
  const before = shownAt.get(JSON.stringify(frame.value)) ?? [];
  // One module having moved is enough: a field that reads its gallery too
  // goes back when either does.
  return versions.some(([path, read]) => {
    if (read.version === null) return false;
    const key = moduleKey(path, read.version);
    const earlier = before.filter((f) => keyOf(f, path) === key);
    if (earlier.length === 0) return true;
    // The same version again: only when the chain went back, which `seq`
    // says (it moved past what the surface last showed).
    const lastSeq = previous?.versions?.[path]?.seq;
    return (
      read.seq !== undefined && lastSeq !== undefined && read.seq > lastSeq
    );
  });
}

/**
 * 3. Same version, same value (parity). Any two frames that read every
 * module they read at the same versions show the same value, whichever
 * surface they are and whenever they were recorded: `fetchVal`, `useVal`
 * and a Studio field agree whenever they are at the same content.
 */
function sameVersionSameValue(all: readonly Frame[]): string[] {
  const byVersions = new Map<string, Frame>();
  for (const frame of all) {
    const versions = versionsOf(frame);
    if (versions.length === 0) continue;
    if (versions.some(([, read]) => read.version === null)) continue;
    const key = versions
      .map(([path, read]) =>
        read.version === null ? "" : moduleKey(path, read.version),
      )
      .sort()
      .join(" ");
    const first = byVersions.get(key);
    if (first === undefined) {
      byVersions.set(key, frame);
      continue;
    }
    if (JSON.stringify(first.value) !== JSON.stringify(frame.value)) {
      return [
        `✕ same version, same value: "${first.surface}" at ${first.at} and "${frame.surface}" at ${frame.at} read the same versions and show different values\n${describe([first, frame])}`,
      ];
    }
  }
  return [];
}

/**
 * 4. Never read with another schema. No surface shows content whose schema
 * version is not the schema of the code that read it.
 */
function neverWithAnotherSchema(all: readonly Frame[]): string[] {
  for (const frame of all) {
    for (const [path, read] of versionsOf(frame)) {
      if (read.version === null || read.readWith === null) continue;
      if (read.version.schema !== read.readWith) {
        return [
          `✕ never with another schema: "${frame.surface}" at ${frame.at} showed ${path} from ${read.from} made with schema ${short(read.version.schema)}, read with ${short(read.readWith)}\n${describe([frame])}`,
        ];
      }
    }
  }
  return [];
}

function versionsOf(frame: Frame): [ModuleFilePath, FrameVersion][] {
  const out: [ModuleFilePath, FrameVersion][] = [];
  for (const [path, read] of Object.entries(frame.versions ?? {})) {
    if (read !== undefined) out.push([path as ModuleFilePath, read]);
  }
  return out;
}

function keyOf(frame: Frame, path: ModuleFilePath): string | null {
  const version = frame.versions?.[path]?.version;
  return version === undefined || version === null
    ? null
    : moduleKey(path, version);
}

function short(sha: string): string {
  return sha === "" ? "—" : sha.slice(0, 6);
}

function describe(frames: readonly Frame[]): string {
  return frames
    .map((f) => {
      const versions = versionsOf(f)
        .map(
          ([path, read]) =>
            `${path.split("/").at(-1)} ${read.from}${
              read.version === null
                ? ""
                : ` s:${short(read.version.schema)} b:${short(read.version.base)} c:${short(read.version.chain)}`
            }${read.seq !== undefined ? ` seq ${read.seq}` : ""}`,
        )
        .join("; ");
      return `  ${String(f.at).padStart(3)}  ${f.surface.padEnd(12)} ${JSON.stringify(f.value)}${versions === "" ? "" : `   [${versions}]`}`;
    })
    .join("\n");
}

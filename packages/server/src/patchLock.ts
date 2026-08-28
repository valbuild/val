import fs from "fs";
import fsPath from "path";
import os from "os";
import crypto from "crypto";

/**
 * A timed, cross-process lock over the patches directory.
 *
 * ## Why there is one at all
 *
 * Nothing serialized writes to the patch store before this. Two dev-server route
 * handlers, two browser tabs and the CLI all wrote to the same directory, and the
 * one guard that existed — a `mkdir` whose stated purpose was to throw when the
 * directory already existed — had its `EEXIST` swallowed by a bare `catch {}`, so
 * a colliding write silently overwrote the patch that was already there. A store
 * that loses a patch that way loses every patch chained behind it too.
 *
 * ## Why a file, and why timed
 *
 * A real lock manager is more than this problem needs: the contenders are a
 * handful of processes on one machine, holding it for milliseconds. What that
 * does need is to survive a holder that dies — `kill -9` on a dev server, a
 * laptop lid, a crashed test — without leaving the store permanently unwritable.
 * Hence an expiry: a lock nobody renews stops being a lock.
 *
 * The file is plain `key: value` text on purpose. When something is stuck, the
 * question is always "who is holding it and since when", and `cat .val/patches.lock`
 * should answer it without a tool.
 *
 * ## The takeover race
 *
 * Two processes can decide the same lock is stale at the same moment, and a blind
 * `unlink` would then let the second one delete the FIRST one's fresh lock. So a
 * stale lock is only removed after being read twice, unchanged, across a poll
 * interval, and the `owner` nonce is what "unchanged" means. Whoever wins the
 * `wx` create afterwards is unique regardless, because that create is atomic —
 * the double read is what stops a winner being deleted a moment after winning.
 */

export const PATCH_LOCK_FILE_NAME = "patches.lock";

export type PatchLockInfo = {
  /** Random per acquisition. Identity of the HOLD, not of the process. */
  owner: string;
  pid: number;
  host: string;
  /** What the holder is doing, for the human reading the file. */
  op: string;
  acquiredAt: string;
  expiresAt: string;
};

export type PatchLock = {
  readonly info: PatchLockInfo;
  /**
   * Push the expiry out. For work that legitimately outlives its TTL — a publish
   * uploading files — rather than for guessing a large TTL up front.
   *
   * Returns false if the lock was taken over in the meantime, which the caller
   * must treat as having lost it.
   */
  renew(ttlMs?: number): boolean;
  /** Idempotent, and never removes a lock that is no longer ours. */
  release(): void;
};

export type AcquirePatchLockResult =
  | { status: "acquired"; lock: PatchLock }
  /** Someone else holds it and did not let go within the timeout. */
  | { status: "busy"; holder: PatchLockInfo | null; message: string }
  | { status: "error"; message: string };

export type AcquirePatchLockOptions = {
  /** How long the lock is good for without a renew. */
  ttlMs: number;
  /** Recorded in the file so a human can see what is holding it. */
  op: string;
  /** How long to keep trying before giving up. */
  timeoutMs?: number;
  pollMs?: number;
  /** Injectable so a test can move time without sleeping through a TTL. */
  now?: () => number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 25;

/**
 * Locks this process is currently holding, released on exit.
 *
 * A best-effort courtesy: it turns the common crash — an unhandled throw, a
 * ctrl-C — into an immediately reusable store instead of one that waits out a
 * TTL. The TTL is still what makes correctness not depend on this running.
 */
const heldLocks = new Set<PatchLock>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) {
    return;
  }
  exitHookInstalled = true;
  process.once("exit", () => {
    heldLocks.forEach((lock) => {
      try {
        lock.release();
      } catch {
        // Nothing useful can be done during exit.
      }
    });
  });
}

export function formatPatchLockInfo(info: PatchLockInfo): string {
  return [
    `owner: ${info.owner}`,
    `pid: ${info.pid}`,
    `host: ${info.host}`,
    `op: ${info.op}`,
    `acquired: ${info.acquiredAt}`,
    `expires: ${info.expiresAt}`,
    "",
  ].join("\n");
}

export function parsePatchLockInfo(raw: string): PatchLockInfo | null {
  const fields: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const { owner, pid, host, op, acquired, expires } = fields;
  if (!owner || !acquired || !expires) {
    return null;
  }
  const parsedPid = Number.parseInt(pid ?? "", 10);
  return {
    owner,
    pid: Number.isNaN(parsedPid) ? -1 : parsedPid,
    host: host ?? "",
    op: op ?? "",
    acquiredAt: acquired,
    expiresAt: expires,
  };
}

function readRaw(lockFilePath: string): string | null {
  try {
    return fs.readFileSync(lockFilePath, "utf-8");
  } catch {
    return null;
  }
}

function isExpired(info: PatchLockInfo | null, nowMs: number): boolean {
  // An unparseable lock file is treated as expired. It is either a half-written
  // acquisition or something that is not a lock at all, and neither should be
  // able to wedge the store forever.
  if (info === null) {
    return true;
  }
  const expiresAt = Date.parse(info.expiresAt);
  if (Number.isNaN(expiresAt)) {
    return true;
  }
  return expiresAt <= nowMs;
}

function describeHolder(info: PatchLockInfo | null): string {
  if (info === null) {
    return "the lock file could not be read";
  }
  return `held by pid ${info.pid} on ${info.host || "unknown host"} for "${
    info.op
  }" since ${info.acquiredAt} (expires ${info.expiresAt})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to create the lock file exclusively.
 *
 * `wx` is `O_CREAT | O_EXCL`: the create either happens or reports EEXIST, with
 * no window in between. Everything else in this module exists to handle the
 * EEXIST case; this is the part that actually provides mutual exclusion.
 */
function tryCreate(
  lockFilePath: string,
  info: PatchLockInfo,
): "created" | "exists" | { error: string } {
  let fd: number;
  try {
    fd = fs.openSync(lockFilePath, "wx");
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "EEXIST"
    ) {
      return "exists";
    }
    return {
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
  try {
    fs.writeSync(fd, formatPatchLockInfo(info));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return "created";
}

export async function acquirePatchLock(
  lockFilePath: string,
  options: AcquirePatchLockOptions,
): Promise<AcquirePatchLockResult> {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const deadline = now() + timeoutMs;

  try {
    fs.mkdirSync(fsPath.dirname(lockFilePath), { recursive: true });
  } catch (err) {
    return {
      status: "error",
      message: `Could not create the directory for ${lockFilePath}: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }

  for (;;) {
    const acquiredAt = now();
    const info: PatchLockInfo = {
      owner: crypto.randomUUID(),
      pid: process.pid,
      host: os.hostname(),
      op: options.op,
      acquiredAt: new Date(acquiredAt).toISOString(),
      expiresAt: new Date(acquiredAt + options.ttlMs).toISOString(),
    };
    const created = tryCreate(lockFilePath, info);
    if (created === "created") {
      const lock = createLock(lockFilePath, info, options.ttlMs, now);
      installExitHook();
      heldLocks.add(lock);
      return { status: "acquired", lock };
    }
    if (created !== "exists") {
      return {
        status: "error",
        message: `Could not create ${lockFilePath}: ${created.error}`,
      };
    }

    const rawBefore = readRaw(lockFilePath);
    if (rawBefore === null) {
      // Released between the failed create and the read. Go straight round again.
      continue;
    }
    const lastSeenHolder = parsePatchLockInfo(rawBefore);

    if (isExpired(lastSeenHolder, now())) {
      // Read twice across a poll interval before removing it: an unchanged stale
      // file is one nobody is renewing, and requiring the second read is what
      // stops two processes both deciding to clear it and the loser wiping the
      // winner's brand-new lock.
      await sleep(pollMs);
      const rawAfter = readRaw(lockFilePath);
      if (rawAfter === rawBefore && isExpired(lastSeenHolder, now())) {
        try {
          fs.unlinkSync(lockFilePath);
        } catch {
          // Someone else got there first, which is the outcome we wanted anyway.
        }
      }
      continue;
    }

    if (now() >= deadline) {
      return {
        status: "busy",
        holder: lastSeenHolder,
        message: `Timed out after ${timeoutMs}ms waiting for the Val patch lock at ${lockFilePath}: ${describeHolder(
          lastSeenHolder,
        )}`,
      };
    }
    await sleep(pollMs);
  }
}

function createLock(
  lockFilePath: string,
  initialInfo: PatchLockInfo,
  defaultTtlMs: number,
  now: () => number,
): PatchLock {
  let info = initialInfo;
  let released = false;

  const stillOurs = (): boolean => {
    const raw = readRaw(lockFilePath);
    if (raw === null) {
      return false;
    }
    return parsePatchLockInfo(raw)?.owner === info.owner;
  };

  const lock: PatchLock = {
    get info() {
      return info;
    },
    renew(ttlMs?: number): boolean {
      if (released || !stillOurs()) {
        return false;
      }
      const next: PatchLockInfo = {
        ...info,
        expiresAt: new Date(now() + (ttlMs ?? defaultTtlMs)).toISOString(),
      };
      const fd = fs.openSync(lockFilePath, "w");
      try {
        fs.writeSync(fd, formatPatchLockInfo(next));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      info = next;
      return true;
    },
    release(): void {
      if (released) {
        return;
      }
      released = true;
      heldLocks.delete(lock);
      // Only ours. If the lock expired and someone else took it, the file now
      // belongs to them and deleting it would hand the store to a third party.
      if (stillOurs()) {
        try {
          fs.unlinkSync(lockFilePath);
        } catch {
          // Already gone.
        }
      }
    },
  };
  return lock;
}

/**
 * Run `fn` while holding the lock, and always give it back.
 *
 * The only shape callers should use: a `release()` that a throw can skip is how
 * a store ends up locked by a process that has long since moved on.
 */
export async function withPatchLock<T>(
  lockFilePath: string,
  options: AcquirePatchLockOptions,
  fn: (lock: PatchLock) => Promise<T> | T,
): Promise<
  | { status: "ok"; value: T }
  | Exclude<AcquirePatchLockResult, { status: "acquired" }>
> {
  const acquired = await acquirePatchLock(lockFilePath, options);
  if (acquired.status !== "acquired") {
    return acquired;
  }
  try {
    return { status: "ok", value: await fn(acquired.lock) };
  } finally {
    acquired.lock.release();
  }
}

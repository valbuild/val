import fs from "fs";
import os from "os";
import fsPath from "path";
import {
  acquirePatchLock,
  AcquirePatchLockOptions,
  formatPatchLockInfo,
  parsePatchLockInfo,
  PatchLock,
  withPatchLock,
} from "./patchLock";

describe("patchLock", () => {
  let dir: string;
  let lockFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(fsPath.join(os.tmpdir(), "val-patch-lock-"));
    lockFile = fsPath.join(dir, "patches.lock");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const opts = (
    overrides?: Partial<AcquirePatchLockOptions>,
  ): AcquirePatchLockOptions => ({
    ttlMs: 5_000,
    op: "test",
    timeoutMs: 200,
    pollMs: 5,
    ...overrides,
  });

  const acquireOrThrow = async (
    overrides?: Partial<AcquirePatchLockOptions>,
  ): Promise<PatchLock> => {
    const res = await acquirePatchLock(lockFile, opts(overrides));
    if (res.status !== "acquired") {
      throw new Error(`expected acquired, got ${res.status}`);
    }
    return res.lock;
  };

  test("the lock file is readable text naming who holds it", async () => {
    const lock = await acquireOrThrow({ op: "PUT /patches" });

    const raw = fs.readFileSync(lockFile, "utf-8");
    expect(raw).toContain(`pid: ${process.pid}`);
    expect(raw).toContain("op: PUT /patches");
    expect(parsePatchLockInfo(raw)?.owner).toBe(lock.info.owner);

    lock.release();
  });

  test("a second acquisition waits, then reports who is holding it", async () => {
    const held = await acquireOrThrow({ op: "publish" });

    const res = await acquirePatchLock(lockFile, opts());
    if (res.status !== "busy") {
      throw new Error(`expected busy, got ${res.status}`);
    }
    expect(res.holder?.owner).toBe(held.info.owner);
    // The message has to be enough to act on without opening the file.
    expect(res.message).toContain(`pid ${process.pid}`);
    expect(res.message).toContain("publish");

    held.release();
  });

  test("releasing hands the lock to the next caller", async () => {
    const first = await acquireOrThrow();
    first.release();
    expect(fs.existsSync(lockFile)).toBe(false);

    const second = await acquireOrThrow();
    expect(second.info.owner).not.toBe(first.info.owner);
    second.release();
  });

  test("release is idempotent", async () => {
    const lock = await acquireOrThrow();
    lock.release();
    expect(() => lock.release()).not.toThrow();
  });

  /**
   * The case the expiry exists for: a dev server killed with the lock held. The
   * store has to become writable again on its own, or the next `pnpm dev` is
   * stuck with no way to know why.
   */
  test("a lock nobody renewed is taken over once it expires", async () => {
    const abandoned = await acquireOrThrow({ ttlMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 40));

    const takenOver = await acquireOrThrow({ timeoutMs: 1_000 });
    expect(takenOver.info.owner).not.toBe(abandoned.info.owner);
    takenOver.release();
  });

  test("a lock file that is not a lock file does not wedge the store", async () => {
    fs.writeFileSync(lockFile, "who knows what this is");

    const lock = await acquireOrThrow({ timeoutMs: 1_000 });
    expect(parsePatchLockInfo(fs.readFileSync(lockFile, "utf-8"))?.owner).toBe(
      lock.info.owner,
    );
    lock.release();
  });

  /**
   * The dangerous half of takeover: the loser of a race must not delete the
   * winner's brand-new lock on its way out.
   */
  test("releasing a lock that was taken over leaves the new holder alone", async () => {
    const expired = await acquireOrThrow({ ttlMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const newHolder = await acquireOrThrow({ timeoutMs: 1_000 });

    expired.release();

    expect(fs.existsSync(lockFile)).toBe(true);
    expect(parsePatchLockInfo(fs.readFileSync(lockFile, "utf-8"))?.owner).toBe(
      newHolder.info.owner,
    );
    newHolder.release();
  });

  test("renewing pushes the expiry out", async () => {
    const lock = await acquireOrThrow({ ttlMs: 50 });
    const before = lock.info.expiresAt;

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lock.renew(10_000)).toBe(true);

    expect(Date.parse(lock.info.expiresAt)).toBeGreaterThan(Date.parse(before));
    expect(
      parsePatchLockInfo(fs.readFileSync(lockFile, "utf-8"))?.expiresAt,
    ).toBe(lock.info.expiresAt);
    lock.release();
  });

  test("renewing a lock that was taken over says so instead of stealing it back", async () => {
    const expired = await acquireOrThrow({ ttlMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const newHolder = await acquireOrThrow({ timeoutMs: 1_000 });

    expect(expired.renew()).toBe(false);
    expect(parsePatchLockInfo(fs.readFileSync(lockFile, "utf-8"))?.owner).toBe(
      newHolder.info.owner,
    );
    newHolder.release();
  });

  describe("withPatchLock", () => {
    test("releases when the body throws", async () => {
      await expect(
        withPatchLock(lockFile, opts(), () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(fs.existsSync(lockFile)).toBe(false);
    });

    test("reports a busy lock instead of running the body", async () => {
      const held = await acquireOrThrow();
      const ran = jest.fn();

      const res = await withPatchLock(lockFile, opts(), ran);

      expect(res.status).toBe("busy");
      expect(ran).not.toHaveBeenCalled();
      held.release();
    });

    /**
     * The whole point, stated as the property that matters: interleaved
     * read-modify-write from many callers must not lose an update. Without the
     * lock the awaits below make this fail essentially every run.
     */
    test("serializes read-modify-write across concurrent callers", async () => {
      const counterFile = fsPath.join(dir, "counter");
      fs.writeFileSync(counterFile, "0");
      const CALLERS = 12;

      const results = await Promise.all(
        Array.from({ length: CALLERS }, () =>
          withPatchLock(lockFile, opts({ timeoutMs: 5_000 }), async () => {
            const value = Number.parseInt(
              fs.readFileSync(counterFile, "utf-8"),
              10,
            );
            await new Promise((resolve) => setTimeout(resolve, 1));
            fs.writeFileSync(counterFile, String(value + 1));
          }),
        ),
      );

      expect(results.every((res) => res.status === "ok")).toBe(true);
      expect(fs.readFileSync(counterFile, "utf-8")).toBe(String(CALLERS));
      expect(fs.existsSync(lockFile)).toBe(false);
    });
  });

  test("info round trips through the file format", () => {
    const info = {
      owner: "3f2a9c1e-8b04-4d2a-9f77-1c0b5a6e2d31",
      pid: 48213,
      host: "some-host",
      op: "DELETE /patches",
      acquiredAt: "2026-08-27T14:54:31.856Z",
      expiresAt: "2026-08-27T14:54:41.856Z",
    };
    expect(parsePatchLockInfo(formatPatchLockInfo(info))).toEqual(info);
  });
});

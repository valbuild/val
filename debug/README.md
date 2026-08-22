# Debug area

Unzip `val debug` snapshots here. Everything except this README is gitignored:
snapshots contain **unpublished customer content**, so do not commit them.

## Reproducing a customer's validation or save errors

```bash
unzip val-debug-<branch>-<commit>-<timestamp>.zip -d debug/<name>
cat debug/<name>/manifest.json    # -> the @valbuild versions, branch and commit
git checkout v<version>           # to reproduce on the code they were running
pnpm debug:replay debug/<name>
```

A snapshot is a minimal Val project: the modules the pending patches touch (plus
the ones those reference), a generated `val.modules.ts`, and the patch chain
under `.val/patches`. `pnpm debug:replay` points a plain `ValOpsFS` at it and
runs the ordinary `analyzePatches` -> `prepare` -> `validateSources` path, so
anything it reproduces is reproduced by production code, not by a test harness.

The replay ends by diffing what it found against `report.json` (captured when the
snapshot was taken), so you can tell "reproduced the bug" from "behaves
differently on this version":

- **still failing** - reproduced.
- **now applying** - fixed since, or the replay drifted from the capture.
- **newly failing** - a regression in the version you have checked out.

## Turning a snapshot into a regression test

Copy it to `packages/server/src/debug/__fixtures__/<name>/` (minus anything
sensitive) and `packages/server/src/debug/replaySnapshot.test.ts` will pick it up.

## Capturing a snapshot

In the customer's project:

```bash
npx val login          # only needed with --remote
npx val debug           # local .val patches
npx val debug --remote  # patches from the hosted project
```

It is read-only. To actually unblock a publish, see `val delete-unappliable-patches`
— but capture the snapshot first, because deleting destroys the evidence.

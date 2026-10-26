import {
  Internal,
  ModuleFilePath,
  PatchId,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnyField } from "../AnyField";
import { FieldErrorsOwned } from "../FieldErrorsOwner";
import { useAllValidationErrors } from "../ValErrorProvider";
import { useSchemaAtPath, useSchemas } from "../ValFieldProvider";
import { useClient, useDeletePatches } from "../ValProvider";
import { useNavigation, VAL_REVIEW_ROUTE } from "../ValRouter";
import { useValSystem } from "../../stores/react/SystemContext";
import { copyText } from "../../utils/copyText";
import {
  buildValidateGroups,
  titleOf,
  type ModuleCheckResult,
} from "./buildValidateGroups";
import {
  ValidatePageView,
  type FullCheckState,
  type RowActionName,
} from "./ValidatePageView";
import {
  useValidateSession,
  validateSession,
  type CheckRun,
} from "./validateSession";
import { useUploadLocalMedia } from "./useUploadLocalMedia";
import { isStudioUploadFix } from "../../utils/uploadLocalMedia";
import { Spinner } from "../designSystem/spinner";

/**
 * `/val/validate`, connected: the Studio's own errors, "Check everything"
 * against `/validate` one module at a time, and **Fix** through
 * `/validate/fix` into an ordinary pending change -- or, for a local file in a
 * project with remote files, an upload made here (`useUploadLocalMedia`).
 */
export function ValidateRoute() {
  const navigation = useNavigation();
  const ownErrors = useAllValidationErrors();
  const schemas = useSchemas();
  const client = useClient();
  const val = useValSystem();
  const { deletePatches } = useDeletePatches();
  const session = useValidateSession();
  const uploadLocalMedia = useUploadLocalMedia();

  /*
   * Which of the Studio's own errors this page lists: the ones it was opened
   * with ("Fix N" passes them), and every path that has had an error since.
   * It only grows, so a row someone fixes in place stays and reads "Fixed."
   * rather than vanishing from under them -- the errors page always worked
   * this way. Growing rather than a snapshot because the Studio's errors
   * arrive after the page does: a snapshot taken on the first render missed
   * every one of them, and the top bar counted errors the page did not list.
   */
  const [ownPaths, setOwnPaths] = useState<SourcePath[]>(() =>
    union(navigation.errorFields, pathsWithErrors(ownErrors)),
  );
  useEffect(() => {
    setOwnPaths((seen) => {
      const next = union(seen, pathsWithErrors(ownErrors));
      return next.length === seen.length ? seen : next;
    });
  }, [ownErrors]);

  const schemaData = schemas.status === "success" ? schemas.data : undefined;
  const { groups, targets } = useMemo(
    () =>
      buildValidateGroups({
        ownPaths,
        ownErrors,
        results: session.results,
        fixes: session.fixes,
        schemas: schemaData,
      }),
    [ownPaths, ownErrors, session.results, session.fixes, schemaData],
  );

  /** The patches this Studio is showing, so the server checks the same content. */
  const shownPatchIds = useCallback((): PatchId[] | undefined => {
    if (val === null) {
      return undefined;
    }
    const store = val.system.patchStore;
    // A patch still on its way to the server is one the server cannot apply:
    // naming it would make it check something else than it says it did.
    return store
      .chainRecords()
      .map((record) => record.patchId)
      .filter((patchId) => !store.isPending(patchId));
  }, [val]);

  /** One module, as `/validate` answers for it. */
  const checkModule = useCallback(
    async (
      moduleFilePath: ModuleFilePath,
      patchIds: PatchId[] | undefined,
    ): Promise<ModuleCheckOutcome> => {
      const res = await client("/validate", "POST", {
        body: { moduleFilePath, ...(patchIds ? { patchIds } : {}) },
      });
      if (res.status === 200) {
        return {
          status: "checked",
          result:
            res.json.invalidSource !== undefined
              ? { status: "invalid-source", message: res.json.invalidSource }
              : {
                  status: "ok",
                  errors: res.json.errors,
                  remoteHosts: res.json.remoteHosts ?? [],
                },
        };
      }
      if (res.status === 404) {
        return { status: "gone" };
      }
      if (res.status === 401) {
        return { status: "signed-out" };
      }
      return {
        status: "failed",
        action: retryCanHelp(res.status) ? "try-again" : "none",
        details:
          res.status === null
            ? "The server could not be reached."
            : `POST /validate → ${res.status}${"json" in res && res.json && "message" in res.json ? `: ${res.json.message}` : ""}`,
      };
    },
    [client],
  );

  const checkEverything = useCallback(async () => {
    if (!schemaData) {
      return;
    }
    const order = (Object.keys(schemaData) as ModuleFilePath[]).sort();
    validateSession.start(order);
    const patchIds = shownPatchIds();
    for (const moduleFilePath of order) {
      if (validateSession.shouldStop) {
        break;
      }
      const outcome = await checkModule(moduleFilePath, patchIds);
      if (outcome.status === "checked") {
        validateSession.recordModule(moduleFilePath, outcome.result);
      } else if (outcome.status === "gone") {
        // Gone since the schemas were read: nothing to check.
        validateSession.skipModule();
      } else if (outcome.status === "signed-out") {
        validateSession.fail(SIGNED_OUT, undefined, "sign-in");
        return;
      } else {
        const checked = progressOf(validateSession.getSnapshot().run);
        validateSession.fail(
          `The check stopped after ${checked} of ${order.length} files: Val could not check ${moduleFilePath}.`,
          outcome.details,
          outcome.action,
        );
        return;
      }
    }
    validateSession.finish(Date.now());
  }, [checkModule, schemaData, shownPatchIds]);

  /**
   * **Try again** on a host: the modules it holds files of are checked again,
   * and only what that host's files answered is taken from it. The rest of
   * each module stays as the run found it -- including a row fixed since,
   * which would otherwise vanish with its **Undo**.
   */
  const recheck = useCallback(
    async (
      rowId: string,
      host: string,
      moduleFilePaths: readonly ModuleFilePath[],
    ) => {
      validateSession.setFix(rowId, { status: "fixing" });
      const patchIds = shownPatchIds();
      for (const moduleFilePath of moduleFilePaths) {
        const outcome = await checkModule(moduleFilePath, patchIds);
        if (outcome.status === "checked") {
          validateSession.retryHost(moduleFilePath, host, outcome.result);
        } else if (outcome.status !== "gone") {
          validateSession.setFix(
            rowId,
            outcome.status === "signed-out"
              ? { status: "failed", message: SIGNED_OUT, action: "sign-in" }
              : {
                  status: "failed",
                  message: `Val could not check ${moduleFilePath} again. ${outcome.details}`,
                  action: outcome.action,
                },
          );
          return;
        }
      }
      // Answered: the row is either gone, or back with the host's new answer.
      validateSession.setFix(rowId, undefined);
    },
    [checkModule, shownPatchIds],
  );

  const fix = useCallback(
    async (rowId: string) => {
      const target = targets.get(rowId);
      if (target?.kind !== "full" || !target.fix || val === null) {
        return;
      }
      validateSession.setFix(rowId, { status: "fixing" });
      if (isStudioUploadFix(target.fix)) {
        // Uploaded from the browser, as any Studio upload is: the server has
        // no credential to upload with in every mode, and the bytes have to
        // be stored with the patch anyway. See `uploadLocalMedia.ts`.
        const uploaded = await uploadLocalMedia(target.sourcePath, target.fix);
        validateSession.setFix(
          rowId,
          uploaded.status === "ok"
            ? {
                status: "fixed",
                summary: uploaded.summary,
                patchIds: uploaded.patchIds,
              }
            : {
                status: "failed",
                message: uploaded.message,
                action: uploaded.retry ? "try-again" : "none",
              },
        );
        return;
      }
      const patchIds = shownPatchIds();
      const res = await client("/validate/fix", "POST", {
        body: {
          moduleFilePath: target.moduleFilePath,
          sourcePath: target.sourcePath,
          fix: target.fix,
          ...(patchIds ? { patchIds } : {}),
        },
      });
      if (res.status !== 200) {
        validateSession.setFix(rowId, {
          status: "failed",
          message:
            res.status === null
              ? "Val could not be reached, so nothing was changed."
              : res.status === 401
                ? "Your session has ended, so nothing was changed. Sign in, then fix it again."
                : res.json.message,
          // A refusal (not fixable here, or no longer there) answers the same
          // way next time, so it offers nothing to press.
          action:
            res.status === 401
              ? "sign-in"
              : retryCanHelp(res.status)
                ? "try-again"
                : "none",
        });
        return;
      }
      if (res.json.patch.length === 0) {
        validateSession.setFix(rowId, { status: "resolved" });
        return;
      }
      const created = await val.system.patchStore.createPatch(
        target.moduleFilePath,
        res.json.patch,
      );
      if (created.status !== "created") {
        validateSession.setFix(rowId, {
          status: "failed",
          message: `The change could not be saved, so nothing was changed: ${created.message}`,
        });
        return;
      }
      validateSession.setFix(rowId, {
        status: "fixed",
        summary: summaryOf(res.json.patch),
        patchIds: [created.record.patchId],
      });
    },
    [client, shownPatchIds, targets, uploadLocalMedia, val],
  );

  const onRowAction = useCallback(
    (rowId: string, action: RowActionName) => {
      const target = targets.get(rowId);
      switch (action) {
        case "fix":
          void fix(rowId);
          return;
        case "open":
          if (target?.kind === "module") {
            navigation.navigate(target.moduleFilePath);
          } else if (target?.kind === "own" || target?.kind === "full") {
            navigation.navigate(target.sourcePath);
          }
          return;
        case "try-again":
          if (target?.kind === "host") {
            void recheck(rowId, target.host, target.moduleFilePaths);
          }
          return;
        case "review":
          navigation.navigate(VAL_REVIEW_ROUTE);
          return;
        case "undo": {
          const patchIds = session.fixes[rowId]?.patchIds;
          if (patchIds && patchIds.length > 0) {
            deletePatches(patchIds);
          }
          validateSession.setFix(rowId, undefined);
          return;
        }
        case "copy": {
          const row = groups
            .flatMap((group) => group.rows)
            .find((candidate) => candidate.id === rowId);
          if (row?.action.kind === "command") {
            copyText(row.action.command);
          }
          return;
        }
        // Not produced yet: the set checks are step 5 of the plan.
        case "remove-from-set":
        case "remove":
        case "check-module":
          return;
      }
    },
    [deletePatches, fix, groups, navigation, recheck, session.fixes, targets],
  );

  const fixAll = useCallback(
    async (rowIds: string[]) => {
      for (const rowId of rowIds) {
        await fix(rowId);
      }
    },
    [fix],
  );
  const fixableIn = (groupId?: string) =>
    groups
      .filter((group) => groupId === undefined || group.id === groupId)
      .flatMap((group) => group.rows)
      .filter(
        (row) =>
          row.action.kind === "fix" &&
          row.fixState?.status !== "fixed" &&
          row.fixState?.status !== "resolved",
      )
      .map((row) => row.id);

  const now = useNow(session.run.status === "done");
  const fullCheck = fullCheckStateOf(session.run, now);

  return (
    <ValidatePageView
      groups={groups.map((group) => ({
        ...group,
        rows: group.rows.map((row) => {
          const target = targets.get(row.id);
          return target?.kind === "own"
            ? { ...row, body: <OwnFieldBody sourcePath={target.sourcePath} /> }
            : row;
        }),
      }))}
      fullCheck={fullCheck}
      onCheckEverything={() => void checkEverything()}
      onStop={() => validateSession.requestStop()}
      onFixEverything={() => void fixAll(fixableIn())}
      onFixGroup={(groupId) => void fixAll(fixableIn(groupId))}
      onRowAction={onRowAction}
    />
  );
}

/** The field itself, so an error in the content is fixed where it is listed. */
function OwnFieldBody({ sourcePath }: { sourcePath: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(sourcePath);
  if (schemaAtPath.status !== "success") {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-secondary">
        <Spinner size={14} aria-hidden />
        <span>Loading field&hellip;</span>
      </div>
    );
  }
  return (
    // The row states the error itself, so the field must not repeat it. See
    // `FieldErrorsOwner`.
    <FieldErrorsOwned>
      <AnyField path={sourcePath} schema={schemaAtPath.data} />
    </FieldErrorsOwned>
  );
}

function union(
  first: readonly SourcePath[],
  second: readonly SourcePath[],
): SourcePath[] {
  return [...first, ...second.filter((path) => !first.includes(path))];
}

function pathsWithErrors(
  errors: Record<SourcePath, ValidationError[] | undefined>,
): SourcePath[] {
  return (Object.keys(errors) as SourcePath[]).filter(
    (path) => (errors[path]?.length ?? 0) > 0,
  );
}

type ModuleCheckOutcome =
  | { status: "checked"; result: ModuleCheckResult }
  /** Not in the project any more. */
  | { status: "gone" }
  | { status: "signed-out" }
  | { status: "failed"; details: string; action: "try-again" | "none" };

/**
 * Whether asking again can answer differently: the server did not answer, or
 * failed on its side. A refusal -- and a 501, a server without the check --
 * answers the same way every time.
 */
function retryCanHelp(status: number | null): boolean {
  return status === null || (status >= 500 && status !== 501);
}

const SIGNED_OUT =
  "Your session has ended, so the check stopped. Sign in, then check again.";

function progressOf(run: CheckRun): number {
  return run.status === "running" ? run.checked : 0;
}

/**
 * What a fix wrote, in a line: `width 1, height 1`. A fix that replaces a
 * whole media value is summed up by what it read from the file.
 */
function summaryOf(patch: Patch): string {
  return patch
    .flatMap((op) => {
      if (op.op === "remove" && op.path.length > 0) {
        // An entry of a media directory whose file is gone.
        return [`removed ${op.path[op.path.length - 1]}`];
      }
      if ((op.op !== "add" && op.op !== "replace") || op.path.length === 0) {
        return [];
      }
      const value = op.value;
      const field = op.path[op.path.length - 1];
      if (field === "path" && typeof value === "string") {
        // A ref pointed at another host: the host is the news, not the URL.
        const ref = Internal.remote.splitRemoteRef(value);
        return [
          ref.status === "success"
            ? `address on ${hostOf(ref.remoteHost)}`
            : `address ${value}`,
        ];
      }
      if (typeof value === "string" || typeof value === "number") {
        return [`${field} ${value}`];
      }
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        // `path` is an address, and `alt` is the editor's: a fix carries it
        // over, it never changes it.
        return Object.entries(value).flatMap(([key, field]) =>
          key !== "path" &&
          key !== "alt" &&
          (typeof field === "string" || typeof field === "number")
            ? [`${key} ${field}`]
            : [],
        );
      }
      return [];
    })
    .join(", ");
}

/** How long ago, in words; re-read every half minute while it is shown. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** `3f9a2c1.valstart.dev`, from `https://3f9a2c1.valstart.dev/_val`. */
function hostOf(remoteHost: string): string {
  try {
    return new URL(remoteHost).host;
  } catch {
    return remoteHost;
  }
}

function agoOf(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

function fullCheckStateOf(run: CheckRun, now: number): FullCheckState {
  switch (run.status) {
    case "not-run":
      return { status: "not-run" };
    case "running": {
      // The files around the one being checked, not all of them: a project
      // with fifty modules would push the results off the screen.
      const from = Math.max(0, run.checked - 2);
      return {
        status: "running",
        checked: run.checked,
        total: run.order.length,
        modules: run.order.slice(from, run.checked + 3).map((module, i) => ({
          title: titleOf(module),
          state:
            from + i < run.checked
              ? "checked"
              : from + i === run.checked
                ? "checking"
                : "waiting",
        })),
      };
    }
    case "done":
      return { status: "done", checkedAgo: agoOf(run.at, now) };
    case "stopped":
      return { status: "stopped", checked: run.checked, total: run.total };
    case "failed":
      return {
        status: "failed",
        message: run.message,
        ...(run.details ? { details: run.details } : {}),
        ...(run.action ? { action: run.action } : {}),
      };
  }
}

import {
  ModuleFilePath,
  PatchId,
  FatalErrorType,
  ValidationErrors,
  SourcePath,
  Internal,
  ModulePath,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";

export type Author = {
  id: AuthorId;
  name: string;
  avatarUrl?: string;
};
type AuthorId = string;

type SourceChangeItem = {
  path: ModulePath;
  type: "replace" | "move" | "add" | "remove";
  filePath?: string;
  count: number;
  changedAt?: string;
  patchIds: PatchId[];
  // TODO: display a notification symbol on the last change on a source path with a validation error
  // notification?: "error" | "warning";
  // TODO: it would be awesome to get a diff, but too much work for now:
  // diff?:
  //   | {
  //       before: string;
  //       after: string;
  //     }
  //   | {
  //       before: RichText<AnyRichTextOptions>;
  //       after: RichText<AnyRichTextOptions>;
  //     };
};

export type History = {
  author?: Author;
  lastChangedAt: string;
  changeCount: number;
  changes: {
    moduleFilePath: ModuleFilePath;
    items: SourceChangeItem[];
  }[];
}[];

export type ReviewErrors = {
  errors?: Record<ModuleFilePath, ReviewModuleError>;
};

export type ReviewModuleError = {
  fatalErrors?: string[];
  validations: {
    path: ModulePath;
    lastChangedBy?: Author;
    lastChangedAt?: string;
    messages: {
      message: string;
      severity: "error" | "warning";
    }[];
  }[];
};

export function convertPatchErrors(
  patches: Record<
    ModuleFilePath,
    {
      patch: Patch;
      patch_id: PatchId;
      created_at: string;
      commit_sha?: string;
      author?: AuthorId;
    }[]
  >,
  validationRes?: {
    modules?: Record<
      ModuleFilePath,
      {
        patches: {
          applied: PatchId[];
          failed?: PatchId[];
        };
      }
    >;
    validationErrors?:
      | false
      | Record<
          ModuleFilePath,
          {
            errors?: {
              validation?: ValidationErrors;
              fatal?: {
                message: string;
                stack?: string;
                type?: FatalErrorType;
              }[];
            };
          }
        >;
  },
  authors?: Record<AuthorId, Author>
): {
  history: History;
  errors?: ReviewErrors; // TODO: do we in fact need a separate type for this? We need authors and dates, but maybe the format could be more or less the same as ValidationErrors?
} {
  // TODO: this is quite long and heavy and, most likely, impossible to maintain. If you are here, planning to do some changes, you should consider rewriting it completely.
  const history: History = [];

  let lastHistoryItem: History[number] | undefined;
  let currentAuthorChanges: Record<
    ModuleFilePath,
    Record<
      ModulePath,
      {
        type: "replace" | "move" | "add" | "remove";
        count: number;
        filePath?: string;
        changedAt?: string;
        changedBy?: Author;
        patchIds: PatchId[];
      }[]
    >
  > = {};
  const lastChangedAtBySourcePath: Record<SourcePath, string> = {};
  const lastChangedAuthorBySourcePath: Record<SourcePath, Author> = {};
  for (const [moduleFilePathS, modulePatches] of Object.entries(patches)) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    for (const patch of modulePatches) {
      const author = authors?.[patch.author || ""];

      // either init or new author
      if (!lastHistoryItem || lastHistoryItem.author?.id !== author?.id) {
        if (lastHistoryItem) {
          // means we have a new author
          history.push({
            ...lastHistoryItem,
            changes: getChangesFromCurrent(currentAuthorChanges),
          });
        }
        // reset changes
        currentAuthorChanges = {};
        // init new author
        lastHistoryItem = {
          author,
          lastChangedAt: patch.created_at,
          changeCount: 0,
          changes: [],
        };
      }

      if (!currentAuthorChanges[moduleFilePath]) {
        currentAuthorChanges[moduleFilePath] = {};
      }

      for (const op of patch.patch) {
        lastHistoryItem.lastChangedAt = patch.created_at;
        lastHistoryItem.changeCount++;

        const modulePath = Internal.patchPathToModulePath(op.path);
        if (!currentAuthorChanges[moduleFilePath][modulePath]) {
          currentAuthorChanges[moduleFilePath][modulePath] = [];
        }
        if (
          !lastChangedAtBySourcePath[
            `${moduleFilePath}.${modulePath}` as SourcePath
          ] ||
          new Date(patch.created_at).getTime() >
            new Date(
              lastChangedAtBySourcePath[
                `${moduleFilePath}.${modulePath}` as SourcePath
              ]
            ).getTime()
        ) {
          lastChangedAtBySourcePath[
            `${moduleFilePath}.${modulePath}` as SourcePath
          ] = patch.created_at;
          if (author) {
            lastChangedAuthorBySourcePath[
              `${moduleFilePath}.${modulePath}` as SourcePath
            ] = author;
          }
        }
        switch (op.op) {
          case "add":
          case "remove":
          case "replace":
          case "move": {
            const currentItem = currentAuthorChanges[moduleFilePath][
              modulePath
            ]?.find((change) => change.type === op.op);
            if (!currentItem) {
              currentAuthorChanges[moduleFilePath][modulePath].push({
                type: op.op,
                count: 1,
                patchIds: [patch.patch_id],
                changedAt: patch.created_at,
                changedBy: author,
              });
            } else {
              currentItem.count++;
              currentItem.patchIds.push(patch.patch_id);
              currentItem.changedAt = patch.created_at;
            }
            break;
          }
          case "file": {
            const filePath = op.filePath;
            const currentFileChange = currentAuthorChanges[moduleFilePath][
              modulePath
            ].find((fileChange) => fileChange.filePath === filePath);
            if (!currentFileChange) {
              currentAuthorChanges[moduleFilePath][modulePath].push({
                filePath: filePath,
                type: "replace",
                count: 1,
                changedAt: patch.created_at,
                patchIds: [patch.patch_id],
              });
            } else {
              currentFileChange.count++;
              currentFileChange.patchIds.push(patch.patch_id);
              currentFileChange.changedAt = patch.created_at;
            }
            break;
          }
        }
      }
    }
  }

  if (lastHistoryItem) {
    history.push({
      ...lastHistoryItem,
      changes: getChangesFromCurrent(currentAuthorChanges),
    });
  }

  // sort everything:
  // TODO: feels like we are doing a lot of unnecessary sorting here
  for (const historyItem of history) {
    for (const change of historyItem.changes) {
      change.items.sort((a, b) => {
        return a.changedAt && b.changedAt
          ? new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime()
          : 0;
      });
    }
    historyItem.changes.sort((a, b) => {
      const lastChangeA = a.items[a.items.length - 1].changedAt;
      const lastChangeB = b.items[b.items.length - 1].changedAt;
      if (!lastChangeA) return 1;
      if (!lastChangeB) return -1;

      return new Date(lastChangeA).getTime() - new Date(lastChangeB).getTime();
    });
  }

  history.sort((a, b) => {
    return (
      new Date(a.lastChangedAt).getTime() - new Date(b.lastChangedAt).getTime()
    );
  });

  //
  const reviewErrors: [ModuleFilePath, ReviewModuleError][] = [];
  if (validationRes?.validationErrors) {
    for (const [moduleFilePathStr, validationError] of Object.entries(
      validationRes.validationErrors
    )) {
      const moduleFilePath = moduleFilePathStr as ModuleFilePath;
      const reviewModuleError: ReviewModuleError = {
        validations: [],
      };
      if (validationError.errors?.fatal) {
        reviewModuleError.fatalErrors = validationError.errors.fatal.map(
          (error) => error.message
        );
      }
      if (validationError.errors?.validation) {
        for (const [sourcePathS, messages] of Object.entries(
          validationError.errors.validation
        )) {
          const sourcePath = sourcePathS as SourcePath;

          const [, modulePath] =
            Internal.splitModuleFilePathAndModulePath(sourcePath);
          if (messages.length > 0) {
            reviewModuleError.validations.push({
              path: modulePath,
              messages: messages.map((message) => ({
                message: message.message,
                severity: "warning",
              })),
              lastChangedAt: lastChangedAtBySourcePath[sourcePath],
              lastChangedBy: lastChangedAuthorBySourcePath[sourcePath],
            });
          }
        }
      }
      reviewErrors.push([moduleFilePath, reviewModuleError]);
    }
  }

  return {
    history,
    errors:
      reviewErrors.length > 0
        ? { errors: Object.fromEntries(reviewErrors) }
        : undefined,
  };
}

function getChangesFromCurrent(
  currentAuthorChanges: Record<
    ModuleFilePath,
    Record<
      ModulePath,
      {
        type: "replace" | "move" | "add" | "remove";
        count: number;
        patchIds: PatchId[];
        filePath?: string;
        changedAt?: string;
        changedBy?: Author;
      }[]
    >
  >
): History[number]["changes"] {
  const changes: History[number]["changes"] = [];
  for (const [moduleFilePathStr, moduleChanges] of Object.entries(
    currentAuthorChanges
  )) {
    const moduleFilePath = moduleFilePathStr as ModuleFilePath;
    const currentModuleChanges: SourceChangeItem[] = [];
    for (const [modulePathS, modulePathChanges] of Object.entries(
      moduleChanges
    )) {
      const modulePath = modulePathS as ModulePath;

      for (const modulePathChange of modulePathChanges) {
        currentModuleChanges.push({
          path: modulePath,
          type: modulePathChange.type,
          filePath: modulePathChange.filePath,
          count: modulePathChange.count,
          changedAt: modulePathChange.changedAt,
          patchIds: modulePathChange.patchIds,
        });
      }
    }
    changes.push({
      moduleFilePath: moduleFilePath,
      items: currentModuleChanges,
    });
  }
  return changes;
}

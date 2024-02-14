import {
  ModuleId,
  PatchId,
  ApiPostValidationResponse,
  ApiPostValidationErrorResponse,
  ApiGetPatchResponse,
  FatalErrorType,
  Json,
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
  count: number;
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
} & {
  changedAt?: string;
};
type FileChange = {
  filePath: string;
  count: number;
  changedAt?: string;
};

export type History = {
  author?: Author;
  lastChangedAt: string;
  changeCount: number;
  changes: (
    | {
        moduleId: ModuleId;
        items: SourceChangeItem[];
      }
    | FileChange
  )[];
}[];

export type ReviewErrors = {
  errors?: Record<ModuleId, ReviewModuleError>;
};

export type ReviewModuleError = {
  fatalErrors?: string[];
  validations: {
    path: SourcePath;
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
    ModuleId,
    {
      patch: Patch;
      patch_id: PatchId;
      created_at: string;
      commit_sha?: string;
      author?: AuthorId;
    }[]
  >,
  validationRes: {
    modules: Record<
      ModuleId,
      {
        patches: {
          applied: PatchId[];
          failed?: PatchId[];
        };
      }
    >;
    validationErrors:
      | false
      | Record<
          ModuleId,
          {
            errors: {
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
  errors?: ReviewErrors;
} {
  const history: History = [];
  const reviewErrors: [ModuleId, ReviewModuleError][] = [];

  const sortedPatches: {
    moduleId: ModuleId;
    patch: Patch;
    patchId: PatchId;
    created_at: string;
    commit_sha?: string;
    author?: AuthorId;
  }[] = [];
  for (const moduleIdS in patches) {
    const moduleId = moduleIdS as ModuleId;
    for (const patch of patches[moduleId]) {
      sortedPatches.push({
        moduleId,
        patch: patch.patch,
        patchId: patch.patch_id,
        created_at: patch.created_at,
        commit_sha: patch.commit_sha,
      });
    }
  }
  sortedPatches.sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  let lastHistoryItem: History[number] | undefined;
  let lastChangesByModuleIdSourcePath: Record<
    ModuleId,
    Record<
      ModulePath,
      {
        type: "replace" | "move" | "add" | "remove";
        count: number;
        changedAt?: string;
      }
    >
  > = {};
  let lastFileChanges: FileChange[] = [];

  for (const patch of sortedPatches) {
    const author = authors?.[patch.author || ""];

    // either init or new author
    if (!lastHistoryItem || lastHistoryItem.author?.id !== author?.id) {
      // reset changes
      lastChangesByModuleIdSourcePath = {};
      lastFileChanges = [];
      //
      if (lastHistoryItem) {
        // means we have a new author
        history.push({
          ...lastHistoryItem,
        });
      }
      // init new author
      lastHistoryItem = {
        author,
        lastChangedAt: patch.created_at,
        changeCount: 0,
        changes: [],
      };
    }

    const changes: History[number]["changes"] = [];
    if (!lastChangesByModuleIdSourcePath[patch.moduleId]) {
      lastChangesByModuleIdSourcePath[patch.moduleId] = {};
    }

    for (const op of patch.patch) {
      const modulePath = Internal.patchPathToModulePath(op.path);

      switch (op.op) {
        case "add":
        case "remove":
        case "replace":
        case "move":
          const currentItem =
            lastChangesByModuleIdSourcePath[patch.moduleId][modulePath];
          if (!currentItem) {
            lastChangesByModuleIdSourcePath[patch.moduleId][modulePath] = {
              type: op.op,
              count: 1,
              changedAt: patch.created_at,
            };
          } else {
            currentItem.count++;
            currentItem.changedAt = patch.created_at;
          }
          break;
        case "file":
          const filePath = op.filePath;
          const currentFileChange = lastFileChanges.find(
            (fileChange) => fileChange.filePath === filePath
          );
          if (!currentFileChange) {
            lastFileChanges.push({
              filePath: filePath,
              count: 1,
              changedAt: patch.created_at,
            });
          } else {
            currentFileChange.count++;
            currentFileChange.changedAt = patch.created_at;
          }
          break;
      }
    }
    for (const moduleIdS in lastChangesByModuleIdSourcePath) {
      const moduleId = moduleIdS as ModuleId;
      const items: SourceChangeItem[] = [];
      for (const modulePathS in lastChangesByModuleIdSourcePath[moduleId]) {
        const modulePath = modulePathS as ModulePath;
        const item = lastChangesByModuleIdSourcePath[moduleId][modulePath];
        items.push({
          path: modulePath,
          type: item.type,
          count: item.count,
          changedAt: item.changedAt,
        });
      }
      changes.push({
        moduleId,
        items,
      });
    }
    changes.push(...lastFileChanges);

    lastHistoryItem.lastChangedAt = patch.created_at;
    lastHistoryItem.changeCount = changes.reduce((prev, curr) => {
      if ("items" in curr) {
        return prev + curr.items.reduce((prev, curr) => prev + curr.count, 0);
      }
      return prev + curr.count;
    }, 0);
    lastHistoryItem.changes = changes;
  }
  if (lastHistoryItem) {
    history.push(lastHistoryItem);
  }

  return {
    history,
    errors:
      reviewErrors.length > 0
        ? { errors: Object.fromEntries(reviewErrors) }
        : undefined,
  };
}

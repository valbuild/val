import { z } from "zod";
import {
  type ValidationFix,
  type ModuleFilePath,
  type ValConfig,
} from "@valbuild/core";
import {
  VAL_ENABLE_COOKIE_NAME,
  VAL_SESSION_COOKIE,
  VAL_STATE_COOKIE,
} from "./server/types";
import { Patch, PatchId } from "./zod/Patch";
import { SerializedSchema } from "./zod/SerializedSchema";
import { ValCommit } from "./zod/ValCommit";

const ModuleFilePath = z.string().refine(
  (_path): _path is ModuleFilePath => true, // TODO: validation
);

const ParentRef = z.union([
  z.object({ type: z.literal("head"), headBaseSha: z.string() }),
  z.object({ type: z.literal("patch"), patchId: PatchId }),
]);

const ValConfig = z.object({
  project: z.string().optional(),
  root: z.string().optional(),
  files: z
    .object({
      directory: z.string(), // TODO: validate that it is prefixed by /public/
    })
    .optional(),
  gitCommit: z.string().optional(),
  gitBranch: z.string().optional(),
});

const ValidationFixZ: z.ZodSchema<ValidationFix> = z.union([
  z.literal("image:add-metadata"),
  z.literal("image:check-metadata"),
  z.literal("image:check-remote"),
  z.literal("image:upload-remote"),
  z.literal("image:download-remote"),
  z.literal("images:check-remote"),
  z.literal("images:upload-remote"),
  z.literal("file:add-metadata"),
  z.literal("file:check-metadata"),
  z.literal("file:check-remote"),
  z.literal("file:upload-remote"),
  z.literal("file:download-remote"),
  z.literal("files:check-remote"),
  z.literal("files:upload-remote"),
  z.literal("keyof:check-keys"),
  z.literal("router:check-route"),
  z.literal("images:check-unique-folder"),
  z.literal("files:check-unique-folder"),
  z.literal("images:check-all-files"),
  z.literal("files:check-all-files"),
  z.literal("jsonValues:extract-entry"),
]);
const ValidationError = z.object({
  message: z.string(),
  value: z.unknown().optional(),
  fatal: z.boolean().optional(),
  fixes: z.array(ValidationFixZ).optional(),
});

const unauthorizedResponse = z.object({
  status: z.literal(401),
  json: z.object({
    message: z.string(),
  }),
});
const notFoundResponse = z.object({
  status: z.literal(404),
  json: z.object({
    message: z.string(),
  }),
});
const GenericError = z.object({ message: z.string() });

/**
 * A patch group: the set of patches one user has chosen to publish.
 *
 * Not a patch *set* — a patch set is computed from the schema and says which
 * patches must move together; a patch group is curated and says which ones this
 * user wants live. See `docs/independent-publish/PLAN.md`.
 */
const PatchGroup = z.object({
  patchGroupId: z.string(),
  authorId: z.string().nullable(),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  patchIds: z.array(PatchId),
});
export type PatchGroupT = z.infer<typeof PatchGroup>;

const GenericPatchError = z.union([
  z.object({
    patchId: PatchId,
    message: z.string(),
  }),
  z.object({
    parentPatchId: z.string(),
    message: z.string(),
  }),
]);

const ModulesError = z.object({
  message: z.string(),
  path: ModuleFilePath.optional(),
});

const cookies = z.union([
  z.literal("val_session"),
  z.literal("val_enable"),
  z.literal("val_state"),
]);
type Cookies = z.infer<typeof cookies>;

const enableCookieValue = z.object({
  value: z.literal("true"),
  options: z.object({
    httpOnly: z.literal(false),
    sameSite: z.literal("lax"),
  }),
});

type EnableCookieValue = z.infer<typeof enableCookieValue>;
type CookieValue =
  | EnableCookieValue
  | {
      value: "false" | string | null;
      options?: {
        httpOnly: boolean;
        sameSite: "lax" | "strict";
        expires: Date;
      };
    };

const onlyOneStringQueryParam = z
  .array(z.string())
  .max(1, "At most one query param is allowed")
  .transform((arg) => arg[0]);
const onlyOneBooleanQueryParam = onlyOneStringQueryParam
  .refine(
    (arg) => arg === "true" || arg === "false",
    "Value must be true or false",
  )
  .transform((arg) => arg === "true");
const onlyOneIntQueryParam = onlyOneStringQueryParam
  .refine(
    (arg) => /^\d+$/.test(arg),
    "Value must be a non-negative whole number",
  )
  .transform((arg) => parseInt(arg, 10));

/**
 * Upper bound on how many `.jsonValues()` entries one `/json` request may ask
 * for. Callers page through bigger sets; the Studio chunks its key windows to
 * this. Shared so client and server agree on the limit.
 */
export const JSON_ENTRIES_BATCH_MAX = 100;

export const Api = {
  "/draft/enable": {
    GET: {
      req: {
        query: {
          redirect_to: onlyOneStringQueryParam.optional(),
        },
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        z.object({
          status: z.literal(401),
          json: GenericError,
        }),
        z.object({
          status: z.literal(302),
          redirectTo: z.string(),
        }),
        z.object({
          status: z.literal(400),
          json: z.object({
            message: z.string(),
          }),
        }),
      ]),
    },
  },
  "/draft/disable": {
    GET: {
      req: {
        query: {
          redirect_to: onlyOneStringQueryParam.optional(),
        },
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        z.object({
          status: z.literal(401),
          json: GenericError,
        }),
        z.object({
          status: z.literal(302),
          redirectTo: z.string(),
        }),
        z.object({
          status: z.literal(400),
          json: z.object({
            message: z.string(),
          }),
        }),
      ]),
    },
  },
  "/draft/stat": {
    GET: {
      req: { cookies: { [VAL_SESSION_COOKIE]: z.string().optional() } },
      res: z.union([
        z.object({
          status: z.literal(401),
          json: GenericError,
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            draftMode: z.boolean(),
          }),
        }),
      ]),
    },
  },
  "/enable": {
    GET: {
      req: {
        query: {
          redirect_to: onlyOneStringQueryParam.optional(),
        },
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        z.object({
          status: z.literal(401),
          json: GenericError,
        }),
        z.object({
          status: z.literal(302),
          redirectTo: z.string(),
          cookies: z.object({
            [VAL_ENABLE_COOKIE_NAME]: enableCookieValue,
            [VAL_STATE_COOKIE]: z.object({
              value: z.string(),
              options: z.object({
                httpOnly: z.literal(true),
                sameSite: z.literal("lax"),
                expires: z.instanceof(Date),
              }),
            }),
          }),
        }),
        z.object({
          status: z.literal(302),
          redirectTo: z.string(),
          cookies: z.object({
            [VAL_ENABLE_COOKIE_NAME]: enableCookieValue,
          }),
        }),
        z.object({
          status: z.literal(400),
          json: z.object({
            message: z.string(),
          }),
        }),
      ]),
    },
  },
  "/disable": {
    GET: {
      req: {
        query: {
          redirect_to: onlyOneStringQueryParam.optional(),
        },
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        z.object({
          status: z.literal(401),
          json: GenericError,
        }),
        z.object({
          status: z.literal(302),
          redirectTo: z.string(),
          cookies: z.object({
            [VAL_ENABLE_COOKIE_NAME]: z.object({
              value: z.literal("false"),
            }),
          }),
        }),
        z.object({
          status: z.literal(400),
          json: z.object({
            message: z.string(),
          }),
        }),
      ]),
    },
  },
  "/authorize": {
    GET: {
      req: {
        query: {
          redirect_to: onlyOneStringQueryParam.optional(),
        },
      },
      res: z.union([
        z.object({
          status: z.literal(302),
          redirectTo: z.string(),
          cookies: z.object({
            [VAL_ENABLE_COOKIE_NAME]: enableCookieValue,
            [VAL_STATE_COOKIE]: z.object({
              value: z.string(),
              options: z.object({
                httpOnly: z.literal(true),
                sameSite: z.literal("lax"),
                expires: z.instanceof(Date),
              }),
            }),
          }),
        }),
        z.object({
          status: z.literal(400),
          json: z.object({
            message: z.string(),
          }),
        }),
      ]),
    },
  },
  "/callback": {
    GET: {
      req: {
        query: {
          code: onlyOneStringQueryParam.optional(),
          state: onlyOneStringQueryParam.optional(),
        },
        cookies: { [VAL_STATE_COOKIE]: z.string() },
      },
      res: z.object({
        status: z.literal(302),
        redirectTo: z.string(),
        cookies: z.object({
          [VAL_STATE_COOKIE]: z.object({
            value: z.literal(null),
          }),
          [VAL_ENABLE_COOKIE_NAME]: enableCookieValue.optional(),
          [VAL_SESSION_COOKIE]: z
            .object({
              value: z.string(),
              options: z
                .object({
                  httpOnly: z.literal(true),
                  sameSite: z.literal("strict"),
                  path: z.string(),
                  secure: z.literal(true),
                  expires: z.instanceof(Date),
                })
                .optional(),
            })
            .optional(),
        }),
      }),
    },
  },
  "/session": {
    GET: {
      req: {
        cookies: { val_session: z.string().optional() },
      },
      res: z.union([
        z.object({
          status: z.literal(200),
          json: z.object({
            mode: z.union([z.literal("local"), z.literal("proxy")]),
            enabled: z.boolean(),
          }),
        }),
        z.object({
          status: z.union([
            // TODO: Remove the ones we don't need.
            z.literal(400),
            z.literal(401),
            z.literal(403),
            z.literal(404),
            z.literal(500),
            z.literal(501),
          ]),
          json: z.object({
            message: z.string(),
          }),
        }),
        z.object({
          status: z.literal(401),
          json: z.object({
            message: z.string(),
            details: z.union([
              z.string(),
              z.object({
                reason: z.string(),
              }),
              z.object({
                sub: z.string(),
                exp: z.number(),
                token: z.string(),
                org: z.string(),
                project: z.string(),
              }),
            ]),
          }),
        }),
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
          }),
        }),
      ]),
    },
  },
  "/logout": {
    GET: {
      req: {
        query: {
          redirect_to: onlyOneStringQueryParam.optional(),
        },
      }, // TODO fix req types
      res: z.union([
        z.object({
          status: z.literal(200),
          cookies: z.object({
            [VAL_SESSION_COOKIE]: z
              .object({
                value: z.string(),
                options: z
                  .object({
                    httpOnly: z.literal(true),
                    sameSite: z.literal("strict"),
                    path: z.string(),
                    secure: z.literal(true),
                    expires: z.instanceof(Date),
                  })
                  .optional(),
              })
              .optional(),
            [VAL_STATE_COOKIE]: z
              .object({
                value: z.string(),
                options: z
                  .object({
                    httpOnly: z.literal(true),
                    sameSite: z.literal("strict"),
                    path: z.string(),
                    secure: z.literal(true),
                    expires: z.instanceof(Date),
                  })
                  .optional(),
              })
              .optional(),
          }),
        }),
        z.object({
          status: z.literal(302),
          redirectTo: z.string(),
          cookies: z.object({
            [VAL_SESSION_COOKIE]: z
              .object({
                value: z.string(),
                options: z
                  .object({
                    httpOnly: z.literal(true),
                    sameSite: z.literal("strict"),
                    path: z.string(),
                    secure: z.literal(true),
                    expires: z.instanceof(Date),
                  })
                  .optional(),
              })
              .optional(),
            [VAL_STATE_COOKIE]: z
              .object({
                value: z.string(),
                options: z
                  .object({
                    httpOnly: z.literal(true),
                    sameSite: z.literal("strict"),
                    path: z.string(),
                    secure: z.literal(true),
                    expires: z.instanceof(Date),
                  })
                  .optional(),
              })
              .optional(),
          }),
        }),
      ]),
    },
  },
  "/remote/settings": {
    GET: {
      req: {
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        z.object({
          status: z.literal(200),
          json: z.object({
            publicProjectId: z.string(),
            coreVersion: z.string(),
            remoteFileBuckets: z.array(
              z.object({
                bucket: z.string(),
              }),
            ),
          }),
        }),
        z.object({
          status: z.literal(400),
          json: z.object({
            errorCode: z.union([
              z.literal("project-not-configured"),
              z.literal("error-could-not-get-settings"),
              z.literal("project-not-configured"),
              z.literal("pat-error"),
              z.literal("api-key-missing"),
            ]),
            message: z.string(),
          }),
        }),
        z.object({
          status: z.literal(401),
          json: z.object({
            errorCode: z.literal("unauthorized").optional(),
            message: z.string(),
          }),
        }),
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
          }),
        }),
      ]),
    },
  },
  "/stat": {
    POST: {
      req: {
        body: z
          .object({
            sourcesSha: z.string(),
            schemaSha: z.string(),
            baseSha: z.string(),
            patches: z.array(z.string()).optional(),
            /**
             * Fingerprint of the `.jsonValues()` entry files the client last saw.
             * FS mode only: no other sha can see an entry file change, since a
             * jsonValues module's source is markers and the content sits behind a
             * thunk that `JSON.stringify` drops.
             */
            jsonEntriesSha: z.string().optional(),
          })
          .nullable(),
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        z.object({
          status: z.literal(401),
          json: GenericError,
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
        z.object({
          status: z.literal(503),
          json: GenericError,
        }),
        z.object({
          status: z.literal(200),
          json: z.union([
            z.object({
              type: z.union([
                z.literal("request-again"),
                z.literal("no-change"),
                z.literal("did-change"),
              ]),
              baseSha: z.string(),
              schemaSha: z.string(),
              sourcesSha: z.string(),
              patches: z.array(PatchId),
              // Hash over the caller's patch group membership. Patch ids alone
              // cannot detect a stage/unstage: the set of pending patches is
              // unchanged, only who holds them. Without this, unstaging in one tab
              // never reaches another. Optional so FS mode can omit it.
              patchGroupsSha: z.string().optional(),
              /**
               * Unpublished changes the store threw away because it could not
               * read them.
               *
               * On stat rather than on `GET /patches` because stat is the
               * channel that always flows: the case worth reporting is a repair
               * that removed EVERYTHING, and then there is nothing left for the
               * studio to fetch, so a notice riding on the fetch is never
               * collected. Said once - the server drains it when it hands it
               * over.
               */
              removed: z
                .array(z.object({ patchId: PatchId, reason: z.string() }))
                .optional(),
              config: ValConfig,
              profileId: z.string().nullable(),
              mode: z.union([z.literal("http"), z.literal("fs")]),
              jsonEntriesSha: z.string().optional(),
            }),
            z.object({
              type: z.literal("use-websocket"),
              url: z.string(),
              nonce: z.string(),
              baseSha: z.string(),
              schemaSha: z.string(),
              sourcesSha: z.string(),
              commitSha: z.string(),
              patches: z.array(PatchId),
              patchGroupsSha: z.string().optional(),
              commits: z.array(ValCommit),
              config: ValConfig,
              profileId: z.string().nullable(),
              mode: z.union([z.literal("http"), z.literal("fs")]),
            }),
          ]),
        }),
      ]),
    },
  },
  // This has a path which is like this: /upload/patches/:patchId/files. Example: /upload/patches/76b9237a-7712-4d60-88b4-d273e6d6fe18/files
  "/upload/patches": {
    POST: {
      req: {
        path: z.string().optional(),
        body: z.object({
          parentRef: ParentRef,
          filePath: z.string(),
          data: z.any(), // TODO: Json zod type
          type: z.union([z.literal("file"), z.literal("image")]),
          metadata: z.any(), // TODO: Json zod type
          remote: z.boolean(),
        }),
      },
      res: z.union([
        z.object({
          status: z.literal(400),
          json: GenericError,
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            filePath: z.string(),
            patchId: PatchId,
          }),
        }),
      ]),
    },
  },
  "/direct-file-upload-settings": {
    POST: {
      req: {
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        z.object({
          status: z.literal(400),
          json: GenericError,
        }),
        z.object({
          status: z.literal(401),
          json: GenericError,
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            nonce: z.string().nullable(),
            baseUrl: z.string(),
            contentBaseUrl: z.string().nullable(),
            contentAuthNonce: z.string().nullable(),
          }),
        }),
      ]),
    },
  },
  "/patches": {
    DELETE: {
      req: {
        query: {
          id: z.array(PatchId).min(1, "At least one patch id is required"),
        },
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
            errors: z.array(GenericPatchError),
          }),
        }),
        z.object({
          status: z.literal(200),
          json: z.array(PatchId),
        }),
      ]),
    },
    PUT: {
      req: {
        body: z.object({
          parentRef: ParentRef,
          sessionId: z.string().nullish(),
          patches: z.array(
            z.object({
              path: ModuleFilePath,
              patchId: PatchId,
              patch: z.any(), // TODO: this should be Patch instead - we got a weird validation error: although input looks good, it still does not accept objects as values... Which it should do via the z.record(JSONValue) type
            }),
          ),
          // Patch group membership. Sent with the patch itself, in one request, so
          // there is no window in which a patch exists but belongs to no group.
          // Absent means "the caller does not know about groups" - the server then
          // behaves exactly as before.
          patchGroupId: z.string().nullish(),
          // The prefix closure: other patch ids that must join the same group for
          // it to stay applicable. Computed on the client, which is the only side
          // that has the schema needed to derive patch sets.
          alsoAddPatchIds: z.array(PatchId).optional(),
          // A group holds every pending patch by default, so a new patch joins every
          // other open group too — except ones deliberately holding this patch's
          // region back. The server cannot work out which those are, because "this
          // patch's region" is a patch set and that needs the schema, so the client
          // names them here.
          holdBackForGroupIds: z.array(z.string()).optional(),
          closureVersion: z.number().optional(),
        }),
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(409), // conflict: i.e. not a head of patches
          json: z.object({
            type: z.literal("patch-head-conflict"),
            message: z.string(),
          }),
        }),
        z.object({
          status: z.literal(400),
          json: z.object({
            type: z.literal("patch-error"),
            message: z.string(),
            errors: z.record(
              ModuleFilePath,
              z.array(
                z.object({
                  error: GenericError,
                }),
              ),
            ),
          }),
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            newPatchIds: z.array(PatchId),
            parentRef: ParentRef,
            patchGroupId: z.string().optional(),
          }),
        }),
      ]),
    },
    GET: {
      req: {
        query: {
          patch_id: z.array(PatchId).optional(),
          exclude_patch_ops: onlyOneBooleanQueryParam.optional(),
        },
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
            patchErrors: z.array(GenericPatchError),
          }),
        }),
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
            error: GenericError,
          }),
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            patches: z.array(
              z.object({
                path: ModuleFilePath,
                patch: Patch.optional(),
                patchId: PatchId,
                createdAt: z.string(),
                authorId: z.string().nullable(),
                appliedAt: z.object({ commitSha: z.string() }).nullable(),
                // Which patch groups hold this patch. Optional so that FS mode, and
                // any server that predates patch groups, can leave it out.
                patchGroupIds: z.array(z.string()).optional(),
              }),
            ),
            patchGroups: z.array(PatchGroup).optional(),
            baseSha: z.string(),
            error: GenericError.optional(),
            errors: z.record(PatchId, GenericError).optional(),
          }),
        }),
      ]),
    },
  },
  // Patch group membership. Both are idempotent set operations, and both take an
  // already-closed set: the client computes the prefix closure (staging) or the
  // forward closure (unstaging) because only the client has the schema needed to
  // derive patch sets. See `docs/independent-publish/PLAN.md`.
  "/patch-groups/~/patches": {
    PUT: {
      req: {
        body: z.object({
          patchGroupId: z.string(),
          patchIds: z
            .array(PatchId)
            .min(1, "At least one patch id is required"),
          closureVersion: z.number(),
        }),
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(403),
          json: GenericError,
        }),
        z.object({
          // The group has already been published, so its membership is frozen.
          status: z.literal(409),
          json: GenericError,
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            patchGroupId: z.string(),
            patchIds: z.array(PatchId),
          }),
        }),
      ]),
    },
    DELETE: {
      req: {
        body: z.object({
          patchGroupId: z.string(),
          patchIds: z
            .array(PatchId)
            .min(1, "At least one patch id is required"),
        }),
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(403),
          json: GenericError,
        }),
        z.object({
          status: z.literal(409),
          json: GenericError,
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            patchGroupId: z.string(),
            patchIds: z.array(PatchId),
          }),
        }),
      ]),
    },
  },
  "/schema": {
    GET: {
      req: {
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
            details: z.array(ModulesError),
          }),
        }),
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
            details: z.array(GenericError),
          }),
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            schemaSha: z.string(),
            schemas: z.record(ModuleFilePath, SerializedSchema),
          }),
        }),
      ]),
    },
  },
  "/sources/~": {
    PUT: {
      req: {
        path: z.string().optional(),
        query: {
          validate_sources: onlyOneBooleanQueryParam.optional(),
          validate_binary_files: onlyOneBooleanQueryParam.optional(),
          exclude_patches: onlyOneBooleanQueryParam.optional(),
          apply_patches: onlyOneBooleanQueryParam.optional(),
          /**
           * Apply ONLY these patches, rather than everything pending.
           *
           * This is what makes a draft-mode render match the caller's staged
           * view. Without it `/sources/~` replays every pending patch on the
           * branch, so a server-rendered preview shows other people's
           * unpublished work — the one thing independent publish is for.
           *
           * Omitted means everything pending, which is the behaviour every
           * existing caller has and must keep. An EMPTY array is a different
           * answer and is honoured as one: a group holding nothing renders
           * base.
           */
          patch_id: z.array(PatchId).optional(),
        },
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(401),
          json: GenericError,
        }),
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
            details: z.union([z.array(ModulesError), GenericError]),
          }),
        }),
        z.object({
          status: z.literal(409),
          json: z.object({
            message: z.string(),
          }),
        }),
        z.object({
          status: z.literal(400),
          json: z.object({
            message: z.string(),
            details: z.array(ModulesError),
          }),
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            schemaSha: z.string(),
            sourcesSha: z.string(),
            modules: z.record(
              ModuleFilePath,
              z.object({
                preview: z.any().optional(), // TODO: improve this type
                source: z.any().optional(), //.optional(), // TODO: Json zod type
                baseSource: z.any().optional(), // pre-patch source for compare view; only set when the server applies patches (apply_patches=true) and the module has pending patches
                patches: z
                  .object({
                    applied: z.array(PatchId),
                    skipped: z.array(PatchId).optional(),
                    errors: z.record(PatchId, GenericError).optional(),
                  })
                  .optional(),
                validationErrors: z
                  .record(z.string(), z.array(ValidationError))
                  .optional(),
              }),
            ),
          }),
        }),
      ]),
    },
  },
  "/profiles": {
    GET: {
      req: {
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            profiles: z.array(
              z.object({
                profileId: z.string(),
                fullName: z.string(),
                email: z.string().optional(),
                avatar: z
                  .object({
                    url: z.string(),
                  })
                  .nullable(),
              }),
            ),
          }),
        }),
      ]),
    },
  },
  "/save": {
    POST: {
      req: {
        body: z.object({
          message: z.string().optional(),
          patchIds: z.array(PatchId),
        }),
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(200),
          json: z.object({
            /**
             * Unpublished changes the save threw away because they could not be
             * applied.
             *
             * `fs` mode only, and the reason the save is a 200 rather than the
             * 400 it used to be: with auto-save on, refusing the whole commit
             * for one bad patch means nothing is ever written again. The rest is
             * written, these are removed, and the studio drops them locally and
             * says so.
             */
            removed: z
              .array(
                z.object({
                  patchId: PatchId,
                  moduleFilePath: ModuleFilePath,
                  message: z.string(),
                }),
              )
              .optional(),
          }),
        }),
        z.object({
          status: z.literal(409),
          json: z.object({
            message: z.string(),
            isNotFastForward: z.literal(true),
          }),
        }),
        z.object({
          status: z.literal(400),
          json: z.union([
            z.object({
              message: z.string(),
              details: z
                .union([
                  z.object({
                    sourceFilePatchErrors: z.record(
                      ModuleFilePath,
                      z.array(GenericError),
                    ),
                    binaryFilePatchErrors: z.record(z.string(), GenericError),
                    /**
                     * The patches that could not be applied, keyed by patch id.
                     *
                     * Same failures as sourceFilePatchErrors, but attributed to
                     * the patch that caused them, which is what the studio needs
                     * in order to name the change and offer to remove it.
                     * Optional so older servers still parse.
                     */
                    unappliablePatches: z
                      .record(
                        PatchId,
                        z.object({
                          moduleFilePath: ModuleFilePath,
                          message: z.string(),
                        }),
                      )
                      .optional(),
                  }),
                  z.array(GenericError),
                ])
                .optional(),
            }),
            z.object({
              message: z.string(),
              errorCode: z.union([
                z.literal("project-not-configured"),
                z.literal("pat-error"),
              ]),
            }),
          ]),
        }),
      ]),
    },
  },
  "/files": {
    GET: {
      req: {
        path: z.string(),
        query: {
          patch_id: z
            .array(PatchId)
            .max(1, "At most one patch id is allowed")
            .transform((arg) => arg[0])
            .optional(),
          remote: onlyOneStringQueryParam.optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        notFoundResponse,
        z.object({
          status: z.literal(200),
          body: z.instanceof(ReadableStream),
        }),
      ]),
    },
  },
  // Loads the content of `.jsonValues()` record/router entries, so the Studio can
  // lazily load just the entries it needs (instead of the whole record), and so
  // the runtime can read draft edits in draft mode.
  //
  // Three request shapes, exactly one of which must be used:
  //   1. `key=<k>`                 — ONE entry; responds `{path, key, content}`.
  //   2. `keys=<k>&keys=<k2>&…`    — a BATCH; responds `{path, entries, missing, errors}`.
  //   3. `offset=<n>&limit=<n>`    — a PAGE of every entry, in module key order;
  //                                  responds as (2) plus `{offset, limit, total}`.
  // (2) and (3) are what make loading many entries one round trip instead of N:
  // the server resolves sources and pending patches ONCE per request, not per entry.
  //
  // Batch failures are per entry, never whole-request: a key with no entry lands in
  // `missing`, a key whose `*.val.json` fails to load lands in `errors`. Only a
  // missing/non-record MODULE is a 404.
  //
  // `apply_patches` defaults to TRUE (as on `/sources/~`): the server replays
  // pending patches for the entry. The Studio passes `false` explicitly, because
  // it owns in-flight client patches the server has not seen yet and applies
  // them itself — letting the server apply them too would double-apply.
  //
  // Shape (3) REQUIRES `apply_patches=false`. Enumerating "every entry" from the
  // base source would silently omit draft-added keys, and the only all-mode caller
  // (the Studio) derives its key set from its own patched source anyway. Callers
  // that need draft-aware enumeration pass explicit `keys`.
  "/json": {
    GET: {
      req: {
        query: {
          path: onlyOneStringQueryParam,
          key: onlyOneStringQueryParam.optional(),
          keys: z.array(z.string()).max(JSON_ENTRIES_BATCH_MAX).optional(),
          offset: onlyOneIntQueryParam.optional(),
          limit: onlyOneIntQueryParam
            .refine(
              (arg) => arg > 0 && arg <= JSON_ENTRIES_BATCH_MAX,
              `limit must be between 1 and ${JSON_ENTRIES_BATCH_MAX}`,
            )
            .optional(),
          apply_patches: onlyOneBooleanQueryParam.optional(),
        },
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        unauthorizedResponse,
        notFoundResponse,
        // Shape (1): single `key`.
        z.object({
          status: z.literal(200),
          json: z.object({
            path: ModuleFilePath,
            key: z.string(),
            // The entry's JSON content (or null if the entry has no value).
            content: z.any(),
          }),
        }),
        // Shapes (2) and (3): `keys` or `offset`+`limit`.
        z.object({
          status: z.literal(200),
          json: z.object({
            path: ModuleFilePath,
            entries: z.array(
              z.object({
                key: z.string(),
                // The entry's JSON content (or null if the entry has no value).
                content: z.any(),
              }),
            ),
            // Requested keys that have no entry (neither committed nor drafted).
            missing: z.array(z.string()),
            // Requested keys whose content could not be loaded.
            errors: z.array(z.object({ key: z.string(), message: z.string() })),
            // All-mode only: the resolved window and the record's total key count.
            offset: z.number().optional(),
            limit: z.number().optional(),
            total: z.number().optional(),
          }),
        }),
        z.object({
          status: z.literal(400),
          json: GenericError,
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
      ]),
    },
  },
  "/ai/initialize": {
    POST: {
      req: {
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(200),
          json: z.object({
            nonce: z.string(),
            wsUrl: z.string(),
            /**
             * The AI providers this project can actually reach.
             *
             * AI runs on a key the org or the user brought, so an org with only
             * an Anthropic key cannot use a GPT model — asking for one gets a
             * refusal. The client owns the model catalog and picks a model whose
             * provider is in here.
             *
             * `string[]` and not an enum on purpose: the content server may add
             * a provider before the Studio knows of it, and a strict enum would
             * reject the whole response over a name this version has not heard
             * of. Unknown entries are simply ignored.
             */
            providers: z.array(z.string()).optional(),
          }),
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
      ]),
    },
  },
  "/ai/sessions": {
    GET: {
      req: {
        query: {
          limit: onlyOneStringQueryParam.optional(),
          cursor_updatedAt: onlyOneStringQueryParam.optional(),
          cursor_id: onlyOneStringQueryParam.optional(),
        },
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(200),
          json: z.object({
            sessions: z.array(
              z.object({
                id: z.string(),
                name: z.string().nullable(),
                createdAt: z.string(),
                updatedAt: z.string(),
              }),
            ),
            nextCursor: z
              .object({
                updatedAt: z.string(),
                id: z.string(),
              })
              .nullable()
              .optional(),
          }),
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
      ]),
    },
    PATCH: {
      req: {
        path: z.string(),
        body: z.object({
          name: z.string(),
        }),
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(200),
          json: z.object({}),
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
      ]),
    },
  },
  "/ai/messages": {
    GET: {
      req: {
        path: z.string(),
        query: {
          limit: onlyOneStringQueryParam.optional(),
          cursor_updatedAt: onlyOneStringQueryParam.optional(),
          cursor_id: onlyOneStringQueryParam.optional(),
        },
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(200),
          json: z.object({
            messages: z.array(
              z.object({
                role: z.string(),
                content: z.union([
                  z.string(),
                  z.array(
                    z.union([
                      z.object({
                        type: z.literal("text"),
                        text: z.string(),
                      }),
                      z.object({
                        type: z.literal("image_url"),
                        url: z.string(),
                      }),
                    ]),
                  ),
                ]),
              }),
            ),
            nextCursor: z
              .object({
                updatedAt: z.string(),
                id: z.string(),
              })
              .nullable()
              .optional(),
          }),
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
      ]),
    },
  },
  "/ai/session-image-to-patch-file": {
    POST: {
      req: {
        body: z.object({
          patchId: PatchId,
          parentRef: ParentRef,
          files: z
            .array(
              z.object({
                filePath: z.string(),
                key: z.string(),
                isRemote: z.boolean().optional(),
              }),
            )
            .min(1),
        }),
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(200),
          json: z.object({
            patchId: PatchId,
            files: z.array(
              z.object({
                filePath: z.string(),
                metadata: z.object({
                  width: z.number(),
                  height: z.number(),
                  mimeType: z.string(),
                }),
              }),
            ),
          }),
        }),
        z.object({
          status: z.literal(400),
          json: z.object({
            message: z.string(),
            details: z
              .object({
                availableKeys: z.array(z.string()).optional(),
              })
              .optional(),
          }),
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
      ]),
    },
  },
  "/ai/images": {
    PATCH: {
      req: {
        body: z.object({
          key: z.string(),
          metadata: z.any(),
          contentType: z.string(),
        }),
        cookies: { [VAL_SESSION_COOKIE]: z.string().optional() },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(200),
          json: z.object({
            key: z.string(),
          }),
        }),
        z.object({
          status: z.literal(500),
          json: GenericError,
        }),
      ]),
    },
  },
} satisfies ApiGuard;

// Types and helper types:

/**
 * Extracts the keys of an object where the value is not undefined.
 */
type DefinedKeys<T> = {
  [K in keyof T]-?: T[K] extends undefined ? never : K;
}[keyof T];

/**
 * Extracts the keys of an object where the value is not undefined.
 * Then picks the keys from the object.
 * This is useful for creating a new object type with only the defined keys.
 * @example
 * type A = { a: string; b?: number };
 * type B = DefinedObject<A>; // { a: string }
 */
type DefinedObject<T> = Pick<T, DefinedKeys<T>>;

/**
 * This schema supports:
 * 1. multiple query params with the same name
 * 2. simple API route definitions where:
 *  2.1. z.array means at least one query params this name is required
 *  2.2. z.optional means no query param of this name is accepted
 *  2.3. z.array(...).optional() means zero or more query params of this name is accepted
 *
 * Do not change this without updating the ValRouter query parsing logic
 * */
// `number` is allowed because the client stringifies every query value before it
// goes on the URL (see createValClient), so a numeric param round-trips fine.
export type ValidQueryParamTypes =
  | boolean
  | number
  | string
  | string[]
  | undefined;
export type ApiEndpoint = {
  req: {
    path?: z.ZodString | z.ZodOptional<z.ZodString>;
    body?: z.ZodTypeAny;
    query?: Record<
      string,
      z.ZodSchema<ValidQueryParamTypes, string[] | undefined>
    >;
    cookies?: Record<string, z.ZodSchema<string | undefined>>;
  };
  res: z.ZodSchema<
    | {
        status: number;
        body: unknown;
        contentType?: string;
        cookies?: Partial<Record<Cookies, CookieValue>>;
      }
    | {
        status: number;
        json?: unknown;
        cookies?: Partial<Record<Cookies, CookieValue>>;
      }
    | {
        cookies?: Partial<Record<Cookies, CookieValue>>;
        status: 302;
        redirectTo: string;
      }
  >;
};
type ApiGuard = Record<
  `/${string}`,
  Partial<Record<"PUT" | "GET" | "POST" | "DELETE" | "PATCH", ApiEndpoint>>
>;

export type ServerOf<Api extends ApiGuard> = {
  [Route in keyof Api]: {
    [Method in keyof Api[Route]]: Api[Route][Method] extends ApiEndpoint
      ? (
          req: DefinedObject<{
            // What is going on here?
            // We want to infer or transform the type of the body, path, query, and cookies
            // It looks a heavy like this, because body, path, ... are optional
            body: Api[Route][Method]["req"]["body"] extends z.ZodTypeAny
              ? z.infer<Api[Route][Method]["req"]["body"]>
              : undefined;
            path: Api[Route][Method]["req"]["path"] extends z.ZodSchema<
              string | undefined
            >
              ? string
              : undefined;
            query: Api[Route][Method]["req"]["query"] extends Record<
              string,
              z.ZodSchema<ValidQueryParamTypes>
            >
              ? {
                  [key in keyof Api[Route][Method]["req"]["query"]]: z.infer<
                    Api[Route][Method]["req"]["query"][key]
                  >;
                }
              : undefined;
            cookies: Api[Route][Method]["req"]["cookies"] extends Record<
              string,
              z.ZodSchema<string | undefined>
            >
              ? {
                  [key in keyof Api[Route][Method]["req"]["cookies"]]: z.infer<
                    Api[Route][Method]["req"]["cookies"][key]
                  >;
                }
              : undefined;
          }>,
        ) => Promise<z.infer<Api[Route][Method]["res"]>>
      : never;
  };
};

export type ClientOf<Api extends ApiGuard> = <
  Route extends keyof Api,
  Method extends keyof Api[Route],
  Endpoint extends Api[Route][Method] extends ApiEndpoint
    ? Api[Route][Method]
    : never,
>(
  route: Route,
  method: Method,
  // Remove cookies from req and change query to a strongly typed Record<string, string>:
  req: DefinedObject<{
    body: Endpoint["req"]["body"] extends z.ZodTypeAny
      ? z.infer<Endpoint["req"]["body"]>
      : undefined;
    path: Endpoint["req"]["path"] extends z.ZodSchema<string | undefined>
      ? z.infer<Endpoint["req"]["path"]>
      : undefined;
    query: Endpoint["req"]["query"] extends Record<
      string,
      z.ZodSchema<ValidQueryParamTypes>
    >
      ? {
          [key in keyof Endpoint["req"]["query"]]: z.infer<
            Endpoint["req"]["query"][key]
          >;
        }
      : undefined;
  }>,
) => Promise<z.infer<Endpoint["res"]> | ClientFetchErrors>;

export type ClientFetchErrors =
  | {
      status: 404;
      json: {
        message: string;
        method: string;
        path: string;
      };
    }
  | {
      status: 413;
      json: {
        message: string;
        method: string;
        path: string;
      };
    }
  | {
      status: 500;
      json: {
        message: string;
        type: "unknown";
      };
    }
  | {
      status: 504; // timeout
      json: {
        message: string;
      };
    }
  | {
      status: null;
      json:
        | {
            type: "network_error";
            retryable: boolean;
            message: string;
            details: string;
          }
        | {
            message: string;
            type: "client_side_validation_error";
            details: {
              validationError: string;
              data: unknown;
            };
          };
    };

export type UrlOf<Api extends ApiGuard> = <
  Route extends keyof Api | "/val",
  Method extends keyof Api[Route] & "GET",
  Endpoint extends Api[Route][Method] extends ApiEndpoint
    ? Api[Route][Method]
    : never,
>(
  // We prefix with host to be able to differentiate api calls and the /val route.
  // At some point we will want to change /api/val and /val to be customizable and then this won't work
  ...args: Route extends "/val"
    ? [route: Route]
    : Endpoint["req"]["query"] extends Record<
          string,
          z.ZodSchema<ValidQueryParamTypes>
        >
      ? [
          route: `/api/val${Route & string}`,
          query: {
            [key in keyof Endpoint["req"]["query"]]: z.infer<
              Endpoint["req"]["query"][key]
            >;
          },
        ]
      : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        [route: `/api/val${Route & string}`, query: {}]
) => string;

export type Api = {
  [Route in keyof typeof Api]: {
    [Method in keyof (typeof Api)[Route]]: (typeof Api)[Route][Method] extends ApiEndpoint
      ? (typeof Api)[Route][Method]
      : never;
  };
};

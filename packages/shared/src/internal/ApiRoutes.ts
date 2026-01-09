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
  z.literal("file:add-metadata"),
  z.literal("file:check-metadata"),
  z.literal("file:check-remote"),
  z.literal("file:upload-remote"),
  z.literal("file:download-remote"),
  z.literal("keyof:check-keys"),
  z.literal("router:check-route"),
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
              config: ValConfig,
              profileId: z.string().nullable(),
              mode: z.union([z.literal("http"), z.literal("fs")]),
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
          patches: z.array(
            z.object({
              path: ModuleFilePath,
              patchId: PatchId,
              patch: z.any(), // TODO: this should be Patch instead - we got a weird validation error: although input looks good, it still does not accept objects as values... Which it should do via the z.record(JSONValue) type
            }),
          ),
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
              }),
            ),
            baseSha: z.string(),
            error: GenericError.optional(),
            errors: z.record(PatchId, GenericError).optional(),
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
                render: z.any(), // TODO: improve this type
                source: z.any(), //.optional(), // TODO: Json zod type
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
  "/commit-summary": {
    GET: {
      req: {
        query: {
          patch_id: z.array(PatchId),
        },
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        unauthorizedResponse,
        z.object({
          status: z.literal(400),
          json: z.object({
            message: z.string(),
          }),
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            patchIds: z.array(PatchId),
            baseSha: z.string(),
            commitSummary: z.string().nullable(),
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
          json: z.object({}), // TODO:
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
                    binaryFilePatchErrors: z.record(GenericError),
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
export type ValidQueryParamTypes = boolean | string | string[] | undefined;
export type ApiEndpoint = {
  req: {
    path?: z.ZodString | z.ZodOptional<z.ZodString>;
    body?: z.ZodTypeAny;
    query?: Record<
      string,
      z.ZodSchema<ValidQueryParamTypes, z.ZodTypeDef, string[] | undefined>
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
  Partial<Record<"PUT" | "GET" | "POST" | "DELETE", ApiEndpoint>>
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
      : // eslint-disable-next-line @typescript-eslint/ban-types
        [route: `/api/val${Route & string}`, query: {}]
) => string;

export type Api = {
  [Route in keyof typeof Api]: {
    [Method in keyof (typeof Api)[Route]]: (typeof Api)[Route][Method] extends ApiEndpoint
      ? (typeof Api)[Route][Method]
      : never;
  };
};

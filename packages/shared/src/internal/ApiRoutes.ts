import { z } from "zod";
import {
  type ValidationFix,
  type ModuleFilePath,
  type PatchId,
} from "@valbuild/core";
import {
  VAL_ENABLE_COOKIE_NAME,
  VAL_SESSION_COOKIE,
  VAL_STATE_COOKIE,
} from "./server/types";
import { Patch } from "./zod/Patch";
import { SerializedSchema } from "./zod/SerializedSchema";
import { SourcePath } from "./zod/SourcePath";

const PatchId = z.string().refine(
  (_id): _id is PatchId => true // TODO:
);
const ModuleFilePath = z.string().refine(
  (_path): _path is ModuleFilePath => true // TODO:
);

const ValidationFixZ: z.ZodSchema<ValidationFix> = z.union([
  z.literal("image:add-metadata"),
  z.literal("image:replace-metadata"),
  z.literal("file:add-metadata"),
  z.literal("file:check-metadata"),
  z.literal("fix:deprecated-richtext"),
]);
const ValidationError = z.object({
  message: z.string(),
  value: z.unknown().optional(),
  fatal: z.boolean().optional(),
  fixes: z.array(ValidationFixZ).optional(),
});

const notFoundResponse = z.object({
  status: z.literal(401),
  json: z.object({
    message: z.string(),
  }),
});
const GenericError = z.object({ message: z.string() });
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

export const Api = {
  "/enable": {
    GET: {
      req: {
        query: {
          redirect_to: z.string().optional(),
        },
      },
      res: z.union([
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
          redirect_to: z.string().optional(),
        },
      },
      res: z.union([
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
          redirect_to: z.string().optional(),
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
          code: z.string().optional(),
          state: z.string().optional(),
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
            mode: z.literal("local"),
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
      req: {}, // TODO fix req types
      res: z.object({
        status: z.literal(200),
        cookies: z.object({
          [VAL_SESSION_COOKIE]: z.object({ value: z.literal(null) }),
          [VAL_STATE_COOKIE]: z.object({ value: z.literal(null) }),
        }),
      }),
    },
  },
  "/patches/~": {
    DELETE: {
      req: {
        query: {
          id: z.array(PatchId),
        },
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        notFoundResponse,
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
            details: z.record(PatchId, GenericError),
          }),
        }),
        z.object({
          status: z.literal(200),
          json: z.array(PatchId),
        }),
      ]),
    },
    GET: {
      req: {
        query: {
          author: z.array(z.string()).optional(),
          patch_id: z.array(PatchId).optional(),
          module_file_path: z.array(ModuleFilePath).optional(),
          omit_patch: z.boolean(), // TODO: rename! we mean that we are not including the actual patch / operations in the response
        },
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        notFoundResponse,
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
            details: z.record(PatchId, GenericError),
          }),
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            patches: z.record(
              PatchId,
              z.object({
                path: ModuleFilePath,
                patch: Patch.optional(),
                createdAt: z.string(),
                authorId: z.string().nullable(),
                appliedAt: z
                  .object({
                    baseSha: z.string(),
                    git: z.object({ commitSha: z.string() }).optional(),
                    timestamp: z.string(),
                  })
                  .nullable(),
              })
            ),
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
        notFoundResponse,
        z.object({
          status: z.literal(500),
          json: z.object({
            message: z.string(),
            details: z.array(ModulesError),
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
  "/tree/~": {
    PUT: {
      req: {
        path: z.string().optional(),
        body: z
          .object({
            patchIds: z.array(PatchId).optional(),
            addPatch: z
              .object({
                path: ModuleFilePath,
                patch: Patch,
              })
              .optional(),
          })
          .optional(),
        query: {
          validate_all: z.boolean().optional(),
          validate_sources: z.boolean().optional(),
          validate_binary_files: z.boolean().optional(),
        },
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        notFoundResponse,
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
          status: z.literal(400),
          json: z.object({
            message: z.string(),
            details: z.array(ModulesError),
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
                  patchId: PatchId,
                  skipped: z.boolean(),
                  error: GenericError,
                })
              )
            ),
          }),
        }),
        z.object({
          status: z.literal(200),
          json: z.object({
            schemaSha: z.string(),
            modules: z.record(
              ModuleFilePath,
              z.object({
                source: z.any(), //.optional(), // TODO: Json zod type
                patches: z
                  .object({
                    applied: z.array(PatchId),
                    skipped: z.array(PatchId).optional(),
                    errors: z.record(PatchId, GenericError).optional(),
                  })
                  .optional(),
                validationErrors: z
                  .record(SourcePath, z.array(ValidationError))
                  .optional(),
              })
            ),
            newPatchId: PatchId.optional(),
          }),
        }),
      ]),
    },
  },
  "/save": {
    POST: {
      req: {
        body: z.object({
          patchIds: z.array(PatchId),
        }),
        cookies: {
          val_session: z.string().optional(),
        },
      },
      res: z.union([
        notFoundResponse,
        z.object({
          status: z.literal(200),
          json: z.object({}), // TODO:
        }),
        z.object({
          status: z.literal(400),
          json: z.object({
            message: z.string(),
            details: z.union([
              z.object({
                sourceFilePatchErrors: z.record(
                  ModuleFilePath,
                  z.array(GenericError)
                ),
                binaryFilePatchErrors: z.record(GenericError),
              }),
              z.array(GenericError),
            ]),
          }),
        }),
      ]),
    },
  },
  "/files": {
    GET: {
      req: {
        path: z.string(),
        query: {
          patch_id: PatchId.optional(),
        },
      },
      res: z.union([
        z.object({
          status: z.literal(200),
          body: z.instanceof(ReadableStream),
        }),
        z.object({
          status: z.literal(404),
          json: z.object({
            message: z.string(),
          }),
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
    query?: Record<string, z.ZodSchema<ValidQueryParamTypes>>;
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
        cookies: Partial<Record<Cookies, CookieValue>>;
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
          }>
        ) => Promise<z.infer<Api[Route][Method]["res"]>>
      : never;
  };
};

export type ClientOf<Api extends ApiGuard> = <
  Route extends keyof Api,
  Method extends keyof Api[Route],
  Endpoint extends Api[Route][Method] extends ApiEndpoint
    ? Api[Route][Method]
    : never
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
  }>
) => Promise<
  | z.infer<Endpoint["res"]>
  | {
      status: 404;
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
      json: {
        type: "network_error";
        message: string;
        details: string;
      };
    }
  | {
      status: null;
      json: { type: "incompatible_types"; message: string; details: string };
    }
>;

export type UrlOf<Api extends ApiGuard> = <
  Route extends keyof Api | "/val",
  Method extends keyof Api[Route] & "GET",
  Endpoint extends Api[Route][Method] extends ApiEndpoint
    ? Api[Route][Method]
    : never
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
        }
      ]
    : [route: `/api/val${Route & string}`]
) => string;

export type Api = {
  [Route in keyof typeof Api]: {
    [Method in keyof (typeof Api)[Route]]: (typeof Api)[Route][Method] extends ApiEndpoint
      ? (typeof Api)[Route][Method]
      : never;
  };
};

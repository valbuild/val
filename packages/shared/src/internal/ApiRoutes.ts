import { z } from "zod";
import {
  type Json,
  type ValidationFix,
  type ModuleFilePath,
  type PatchId,
} from "@valbuild/core";
import { Patch } from "./Patch";

const PatchId = z.string().refine(
  (_id): _id is PatchId => true // TODO:
);
const ModuleFilePath = z.string().refine(
  (_path): _path is ModuleFilePath => true // TODO:
);
const ValidationFixZ: z.ZodSchema<ValidationFix> = z.union([
  z.literal("image:add-metadata"),
  z.literal("image:replace-metadata"), // TODO: rename to image:check-metadata
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
export const Api = {
  "/session": {
    POST: {
      req: {
        body: z.object({
          username: z.string(),
          password: z.string(),
        }),
      },
      res: z.object({
        status: z.literal(200),
        body: z.object({
          token: z.string(),
        }),
      }),
    },
  },
  "/tree/~/*": {
    PUT: {
      req: {
        path: z.string(),
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
          validate_all: z.boolean(),
          validate_sources: z.boolean(),
          validate_binary_files: z.boolean(),
        },
        cookies: {
          val_session: z.string(),
        },
      },
      res: z.union([
        z.object({
          status: z.literal(200),
          body: z.object({
            schemaSha: z.string(),
            modules: z.record(
              ModuleFilePath,
              z.object({
                source: z.string(), // TODO: Json,
                patches: z.object({
                  applied: z.array(PatchId),
                  skipped: z.array(PatchId),
                  errors: z.record(
                    PatchId,
                    z.object({
                      message: z.string(),
                    })
                  ),
                }),
              })
            ),
            validationErrors: z
              .record(PatchId, z.array(ValidationError))
              .optional(),
          }),
        }),
        z.object({
          status: z.literal(500),
          body: z.object({
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

type ApiEndpoint = {
  req: {
    path?: z.ZodString;
    body?: z.ZodTypeAny;
    query?: Record<
      string,
      z.ZodSchema<boolean | number | number[] | string | string[]>
    >;
  } & {
    cookies?: Record<string, z.ZodString>;
  };
  res: z.ZodSchema<{
    status: number;
    body: unknown;
    cookies?: Record<string, true>;
  }>;
};
type ApiGuard = Record<
  `/${string}`,
  Partial<Record<"PUT" | "GET" | "POST", ApiEndpoint>>
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
            path: Api[Route][Method]["req"]["path"] extends undefined
              ? undefined
              : string;
            query: Api[Route][Method]["req"]["query"] extends Record<
              string,
              z.ZodSchema<boolean | number | number[] | string | string[]>
            >
              ? {
                  [key in keyof Api[Route][Method]["req"]["query"]]: z.infer<
                    Api[Route][Method]["req"]["query"][key]
                  >;
                }
              : undefined;
            cookies: Api[Route][Method]["req"]["cookies"] extends Record<
              string,
              z.ZodSchema<string>
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
    path: Endpoint["req"]["path"] extends z.ZodSchema<string>
      ? z.infer<Endpoint["req"]["path"]>
      : undefined;
    query: Endpoint["req"]["query"] extends Record<
      string,
      z.ZodSchema<boolean | number | number[] | string | string[]>
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
      status: 500;
      body: {
        message: string;
      };
    }
  | {
      status: null;
      body: { message: "NETWORK_ERROR" };
    }
>;

export type Api = {
  [Route in keyof typeof Api]: {
    [Method in keyof (typeof Api)[Route]]: (typeof Api)[Route][Method] extends ApiEndpoint
      ? (typeof Api)[Route][Method]
      : never;
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const a: ServerOf<typeof Api> = {
  "/tree/~/*": {
    PUT: async (req) => {
      req.body?.addPatch;
      return {
        status: 200,
        body: { modules: {}, schemaSha: "" },
      };
    },
  },
  "/session": {
    POST: async (req) => {
      req.body.username;
      return {
        status: 200,
        body: {
          token: "",
        },
      };
    },
  },
};
a["/tree/~/*"].PUT({
  path: "",
  body: {
    addPatch: {
      patch: [],
      path: "" as ModuleFilePath,
    },
    patchIds: [],
  },

  query: {
    validate_all: true,
    validate_sources: true,
    validate_binary_files: true,
  },
  cookies: {
    val_session: "",
  },
});

async function test() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: ClientOf<typeof Api> = (() => {}) as any;
  const b = await client("/tree/~/*", "PUT", {
    path: "/",
    body: {
      addPatch: {
        patch: [],
        path: "" as ModuleFilePath,
      },
    },
    query: {
      validate_all: true,
      validate_sources: true,
      validate_binary_files: true,
    },
  });
  if (b.status === 200) {
    b.status;
    b.body.modules;
  }
  client("/session", "POST", {
    body: {
      username: "user",
      password: "password",
    },
  });
}

test();

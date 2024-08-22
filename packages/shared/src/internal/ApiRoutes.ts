import { z } from "zod";
import { Json, ModuleFilePath, PatchId } from "@valbuild/core";
import { Patch } from "./Patch";

export const Api = {
  "/session": {
    POST: {
      req: z.object({
        body: z.object({
          username: z.string(),
          password: z.string(),
        }),
      }),
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
            patchIds: z
              .array(
                z.string().refine(
                  (id): id is PatchId => true // TODO:
                )
              )
              .optional(),
            addPatch: z
              .object({
                path: z.string().refine(
                  (path): path is ModuleFilePath => true // TODO:
                ),
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
          val_session: true,
        },
      },
      res: z.union([
        z.object({
          status: z.literal(200),
          body: z.object({ z: z.string() }),
        }),
        z.object({
          status: z.literal(200),
          body: z.object({ z: z.string() }),
        }),
      ]),
    },
  },
} satisfies ApiGuard;

type DefinedKeys<T> = {
  [K in keyof T]-?: T[K] extends undefined ? never : K;
}[keyof T];
type DefinedObject<T> = Pick<T, DefinedKeys<T>>;

// Types and helper types:
type ApiEndpoint = {
  req: {
    path?: z.ZodString;
    body?: z.ZodA;
    query?: Record<
      string,
      z.ZodSchema<boolean | number | number[] | string | string[]>
    >;
  } & {
    cookies?: Record<string, true>;
  };
  res: z.ZodSchema<{
    status: number;
    body: Json;
  }> & {
    cookies?: Record<string, true>;
  };
};
type ApiGuard = Record<
  `/${string}`,
  Partial<Record<"PUT" | "GET" | "POST", ApiEndpoint>>
>;

type TEST = {
  a: string;
  b: undefined;
};

export type ServerOf<Api extends ApiGuard> = {
  [Route in keyof Api]: {
    [Method in keyof Api[Route]]: Api[Route][Method] extends ApiEndpoint
      ? (
          req: DefinedObject<{
            body: Api[Route][Method]["req"]["body"] extends undefined
              ? never
              : z.infer<Api[Route][Method]["req"]["body"]>;
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
  req: Omit<z.infer<Endpoint["req"]>, "query" | "cookies"> &
    (z.infer<Endpoint["req"]>["query"] extends string[]
      ? {
          query: {
            [key in z.infer<Endpoint["req"]>["query"][number]]: string;
          };
        }
      : unknown)
) => Promise<
  | Omit<z.infer<Endpoint["res"]>, "cookies">
  | {
      status: 500;
      body: {
        message: string;
      };
    }
  | {
      type: "NETWORK_ERROR";
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
const a: ServerOf<typeof Api> = {} as any;
a["/tree/~/*"].PUT({ path: "", body: "", query: [], cookies: [] });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client: ClientOf<typeof Api> = (() => {}) as any;
const b = await client("/tree/~/*", "PUT", {
  path: "/",
  body: "",
  query: {
    a: "a",
  },
});

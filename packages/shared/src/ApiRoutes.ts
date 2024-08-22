import { z } from "zod";
import { Json } from "@valbuild/core";

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
      req: z.object({
        path: z.string(),
        body: z.string(),
        query: z.array(z.literal("a")),
        cookies: z.array(z.literal("a")),
      }),
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

// Types and helper types:
type ApiEndpoint = {
  req: z.ZodSchema<{
    path?: string;
    body?: Json;
    query?: string[];
    cookies?: string[];
  }>;
  res: z.ZodSchema<{
    status: number;
    body: Json;
    cookies?: string[];
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
          req: z.infer<Api[Route][Method]["req"]>
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

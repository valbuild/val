import { execFileSync } from "child_process";
import path from "path";

/**
 * What the CLIENT build keeps of a `createServerFn()` chain: neither its
 * handler nor its validator, which are both server code.
 *
 * Start's own compiler (`handleCreateServerFn`) has always dropped the
 * validator from the client with `stripMethodCall`; this port replaced only the
 * handler, so every validator -- and whatever it imported -- shipped to the
 * browser. Both spellings are covered because both are supported while a
 * supported version set has each: Start 1.169 removed `.inputValidator()` from
 * its runtime, and 1.168 has both (`version-sets/` in valbuild/home).
 *
 * The transform runs in a child process because its parser is
 * `@rolldown/browser`'s, which is ESM-only, and jest runs CommonJS here.
 */

const chain = (
  method: string,
) => `import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
export const greet = createServerFn({ method: "POST" })
  .${method}((raw) => (raw === "VALIDATOR_ONLY" ? null : z.string().parse(raw)))
  .handler(async ({ data }) => "HANDLER_ONLY" + data);
`;

const cases = {
  validator: chain("validator"),
  inputValidator: chain("inputValidator"),
  middlewareBetween: `import { createServerFn } from "@tanstack/react-start";
import { auth } from "./auth";
export const me = createServerFn({ method: "GET" })
  .middleware([auth])
  .validator((raw) => (raw === "VALIDATOR_ONLY" ? null : raw))
  .handler(async () => "HANDLER_ONLY");
`,
  noValidator: `import { createServerFn } from "@tanstack/react-start";
export const ping = createServerFn().handler(async () => "HANDLER_ONLY");
`,
  emptyValidator: `import { createServerFn } from "@tanstack/react-start";
export const bad = createServerFn().validator().handler(async () => 1);
`,
};

type Outcome = { code: string; parses: boolean } | { error: string };
let results: Record<string, { server: Outcome; client: Outcome }>;

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [
      path.join(__dirname, "__fixtures__", "serverFnsProbe.ts"),
      JSON.stringify(cases),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  results = JSON.parse(line!) as typeof results;
}, 120_000);

const codeOf = (outcome: Outcome) => {
  if ("error" in outcome) throw new Error(`transform failed: ${outcome.error}`);
  expect(outcome.parses).toBe(true);
  return outcome.code;
};

describe.each(["validator", "inputValidator", "middlewareBetween"] as const)(
  "%s",
  (name) => {
    test("the client keeps neither the validator nor the handler, and still parses", () => {
      const code = codeOf(results[name]!.client);
      expect(code).not.toContain("VALIDATOR_ONLY");
      expect(code).not.toContain("HANDLER_ONLY");
      expect(code).toContain("__platformClientRpc(");
    });

    test("the server keeps both: the validator runs there", () => {
      const code = codeOf(results[name]!.server);
      expect(code).toContain("VALIDATOR_ONLY");
      expect(code).toContain("HANDLER_ONLY");
    });
  },
);

test("a middleware chain survives on the client", () => {
  expect(codeOf(results.middlewareBetween!.client)).toContain(
    ".middleware([auth])",
  );
});

test("a chain with no validator is only the handler swap", () => {
  const code = codeOf(results.noValidator!.client);
  expect(code).not.toContain("HANDLER_ONLY");
  expect(code).toContain("createServerFn().handler(__platformClientRpc(");
});

test("a validator call with no validator is refused, as Start refuses it", () => {
  expect(results.emptyValidator!.client).toEqual({
    error: expect.stringContaining(
      "validator() must be called with a validator",
    ),
  });
});

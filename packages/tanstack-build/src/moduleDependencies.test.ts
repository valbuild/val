import { execFileSync } from "child_process";
import path from "path";

/**
 * Each Val module's dependencies, as the build resolved its imports, reach
 * the SERVER bundle, where the generated `val.server.ts` reads them
 * (`globalThis.__VAL_MODULE_DEPENDENCIES__`) and hands them to Val's server
 * as `moduleDependencies`. Defined rather than imported, so an older builder
 * or an older generated file is never broken by the other; never in the
 * client bundle, which has no use for them.
 */
test("the server bundle carries each module's dependencies, the client none", () => {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "moduleDependenciesProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  expect(JSON.parse(line!)).toMatchObject({
    server: { map: true, readLeft: false },
    client: { map: false },
  });
}, 300_000);

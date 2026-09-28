import { execFileSync } from "child_process";
import path from "path";

/**
 * `val publish` with no `--artifacts` builds the checkout, and publishes it.
 *
 * What a connected project's CI does on every push to its branch: the runner
 * has a checkout and `node_modules`, content has the build target, and nothing
 * else is needed. So this drives the whole command -- the build target asked
 * of content, the dependency layer built from `node_modules`, the route tree
 * generated, the site built, the artifacts declared and uploaded -- against
 * the fake content service, twice: once with no layer held, once with the
 * layer the first run sent.
 *
 * The build runs in a child process because `@rolldown/browser` is ESM-only
 * and jest runs CommonJS here. See the probe beside this file.
 */
type Declared = {
  buildHash: string;
  commit: string | null;
  branch: string | null;
  layerRev: string | null;
  linksOwnCss: boolean | null;
  keys: string[];
};
type Run = {
  result: { status: string; artifacts?: number };
  declared: Declared[];
  buildTargetCalls: number;
  uploadedLayerRev: string | null;
  sourceHasRoute: boolean;
  clientHasPage: boolean;
  checkoutUntouched: boolean;
};

let probe: { fresh: Run; held: Run };

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "buildPublishProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // tsx's WASI warnings can share stdout; take the last line that parses.
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  probe = JSON.parse(line!) as typeof probe;
}, 300_000);

test("asks content what to build against, and publishes what it built", () => {
  const { fresh } = probe;
  expect(fresh.result.status).toBe("live");
  expect(fresh.buildTargetCalls).toBe(1);
  expect(fresh.declared).toHaveLength(1);
  const [declared] = fresh.declared;
  expect(declared!.commit).toBe("1234567890abcdef1234567890abcdef12345678");
  expect(declared!.branch).toBe("main");
  expect(declared!.keys).toEqual(
    expect.arrayContaining([
      "server",
      "client",
      "css",
      "source",
      "public/robots.txt",
    ]),
  );
  expect(fresh.clientHasPage).toBe(true);
});

test("the stored source is the project's own files", () => {
  expect(probe.fresh.sourceHasRoute).toBe(true);
});

test("a layer content does not hold is built and sent, and named by its own rev", () => {
  const { fresh } = probe;
  expect(fresh.declared[0]!.keys).toContain("layer");
  expect(fresh.uploadedLayerRev).toEqual(expect.any(String));
  expect(fresh.declared[0]!.layerRev).toBe(fresh.uploadedLayerRev);
});

test("a layer content already holds is named, not sent again", () => {
  const { fresh, held } = probe;
  expect(held.result.status).toBe("live");
  expect(held.declared[0]!.keys).not.toContain("layer");
  expect(held.declared[0]!.layerRev).toBe(fresh.uploadedLayerRev);
  // The same checkout is the same build, and so the same publish.
  expect(held.declared[0]!.buildHash).toBe(fresh.declared[0]!.buildHash);
});

test("the checkout is left as it was found", () => {
  // The route tree is generated on disk and put back; the build is written
  // to a temporary directory, not into `.val/publish`.
  expect(probe.fresh.checkoutUntouched).toBe(true);
  expect(probe.held.checkoutUntouched).toBe(true);
});

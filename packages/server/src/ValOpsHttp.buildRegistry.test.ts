import { Internal, initVal } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";

/**
 * Where the code of the build a server runs in can be imported from
 * (`registry` on `GET /manifest`, phase 9 of
 * `docs/plans/one-content-model.md`): a Studio opened on an older build
 * imports it and takes the new schemas in place, instead of reloading.
 *
 * Only a build the platform made has one: `@valbuild/tanstack-build` emits
 * the registry beside the build's client chunks, named after the build, and
 * the platform hands the server that name (`VAL_BUILD`, `publishBuild`).
 */
describe("a build's registry", () => {
  const { config } = initVal();
  const ops = (options: { publishBuild?: string }) =>
    new ValOpsHttp(
      // Unreachable on purpose: nothing here may ask the content service.
      "http://127.0.0.1:9",
      "org/project",
      null,
      { apiKey: "key" },
      { config, modules: [] },
      { config, ...options },
    );

  test("is named after the build the platform runs, with the Val it runs", () => {
    expect(ops({ publishBuild: "abc123" }).buildRegistry()).toEqual({
      entry: "/_app/val-modules-abc123.js",
      core: Internal.VERSION.core,
    });
  });

  test("is not named by a deploy the platform did not make: that Studio reloads instead", () => {
    expect(ops({}).buildRegistry()).toBeNull();
  });
});

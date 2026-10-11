import { ModuleFilePath, SourcePath, ValidationError } from "@valbuild/core";
import {
  buildValidateGroups,
  openRowCount,
  REMOTE_GROUP_ID,
  type ModuleCheckResult,
} from "./buildValidateGroups";

const BLOG = "/content/blog.val.ts" as ModuleFilePath;
const MEDIA = "/content/media.val.ts" as ModuleFilePath;
const at = (module: ModuleFilePath, path: string) =>
  `${module}?p=${path}` as SourcePath;

const build = (
  input: Partial<Parameters<typeof buildValidateGroups>[0]> = {},
) =>
  buildValidateGroups({
    ownPaths: [],
    ownErrors: {},
    results: new Map(),
    fixes: {},
    schemas: undefined,
    ...input,
  });

const rowsOf = (res: ReturnType<typeof build>) =>
  res.groups.flatMap((group) => group.rows);

describe("buildValidateGroups", () => {
  test("lists the Studio's own errors, and a fixed one reads Fixed. and is not counted", () => {
    const title = at(BLOG, '"title"');
    const author = at(BLOG, '"author"');
    const res = build({
      ownPaths: [title, author],
      ownErrors: { [title]: [{ message: "Too long" }], [author]: [] },
    });
    expect(rowsOf(res)).toEqual([
      expect.objectContaining({
        id: `own:${title}`,
        message: "Too long",
        action: { kind: "open" },
      }),
      expect.objectContaining({
        id: `own:${author}`,
        fixState: { status: "resolved" },
      }),
    ]);
    expect(openRowCount(res.groups)).toBe(1);
  });

  test("offers Fix only for the fixes the Studio can make, and the command for the rest", () => {
    const hero = at(MEDIA, '"hero"');
    const remote = at(MEDIA, '"remote"');
    const plain = at(MEDIA, '"caption"');
    const errors: Record<SourcePath, ValidationError[]> = {
      [hero]: [{ message: "No metadata", fixes: ["image:add-metadata"] }],
      [remote]: [{ message: "Not uploaded", fixes: ["image:upload-remote"] }],
      [plain]: [{ message: "Required" }],
    };
    const res = build({
      results: new Map<ModuleFilePath, ModuleCheckResult>([
        [MEDIA, { status: "ok", errors }],
      ]),
    });
    const byMessage = Object.fromEntries(
      rowsOf(res).map((row) => [row.message, row]),
    );
    expect(byMessage["No metadata"]).toMatchObject({
      tone: "fixable",
      action: { kind: "fix" },
    });
    expect(byMessage["Not uploaded"]).toMatchObject({
      tone: "error",
      action: { kind: "command", command: "val validate --fix" },
    });
    expect(byMessage["Required"]).toMatchObject({
      tone: "error",
      action: { kind: "open" },
    });
    expect(res.targets.get(`full:${hero}:0`)).toEqual({
      kind: "full",
      moduleFilePath: MEDIA,
      sourcePath: hero,
      fix: "image:add-metadata",
    });
  });

  test("an error the Studio already shows is not shown twice", () => {
    const title = at(BLOG, '"title"');
    const res = build({
      ownPaths: [title],
      ownErrors: { [title]: [{ message: "Too long" }] },
      results: new Map<ModuleFilePath, ModuleCheckResult>([
        [
          BLOG,
          { status: "ok", errors: { [title]: [{ message: "Too long" }] } },
        ],
      ]),
    });
    expect(rowsOf(res)).toHaveLength(1);
  });

  test("a wrong width and height are one row, fixed at the image", () => {
    // Two rows would leave the second pointing at an error the first fix
    // already removed.
    const hero = at(MEDIA, '"hero"');
    const res = build({
      results: new Map<ModuleFilePath, ModuleCheckResult>([
        [
          MEDIA,
          {
            status: "ok",
            errors: {
              [at(MEDIA, '"hero"."width"')]: [
                {
                  message: "width wrong",
                  value: { actual: 8, expected: 1 },
                  fixes: ["image:check-metadata"],
                },
              ],
              [at(MEDIA, '"hero"."height"')]: [
                {
                  message: "height wrong",
                  value: { actual: 8, expected: 1 },
                  fixes: ["image:check-metadata"],
                },
              ],
            },
          },
        ],
      ]),
    });
    const rows = rowsOf(res);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      message: "Does not match the file: width 8 → 1, height 8 → 1.",
      action: { kind: "fix" },
    });
    expect(res.targets.get(rows[0].id)).toEqual({
      kind: "full",
      moduleFilePath: MEDIA,
      sourcePath: hero,
      fix: "image:check-metadata",
    });
  });

  test("a module whose content cannot be read is one row about the module", () => {
    const res = build({
      results: new Map<ModuleFilePath, ModuleCheckResult>([
        [BLOG, { status: "invalid-source", message: "Unexpected token" }],
      ]),
    });
    const [row] = rowsOf(res);
    expect(row.message).toContain("Unexpected token");
    expect(res.targets.get(row.id)).toEqual({
      kind: "module",
      moduleFilePath: BLOG,
    });
  });

  test("a row fixed this session is marked, and no longer counted", () => {
    const hero = at(MEDIA, '"hero"');
    const res = build({
      results: new Map<ModuleFilePath, ModuleCheckResult>([
        [
          MEDIA,
          {
            status: "ok",
            errors: {
              [hero]: [
                { message: "No metadata", fixes: ["image:add-metadata"] },
              ],
            },
          },
        ],
      ]),
      fixes: {
        [`full:${hero}:0`]: { status: "fixed", summary: "width 1, height 1" },
      },
    });
    expect(rowsOf(res)[0].fixState).toEqual({
      status: "fixed",
      summary: "width 1, height 1",
    });
    expect(openRowCount(res.groups)).toBe(0);
  });

  test("modules are in path order, own errors first within each", () => {
    const title = at(BLOG, '"title"');
    const res = build({
      ownPaths: [title],
      ownErrors: { [title]: [{ message: "Too long" }] },
      results: new Map<ModuleFilePath, ModuleCheckResult>([
        [
          MEDIA,
          { status: "ok", errors: { [at(MEDIA, '"x"')]: [{ message: "A" }] } },
        ],
        [
          BLOG,
          { status: "ok", errors: { [at(BLOG, '"y"')]: [{ message: "B" }] } },
        ],
      ]),
    });
    expect(res.groups.map((group) => group.id)).toEqual([BLOG, MEDIA]);
    expect(res.groups[0].rows.map((row) => row.message)).toEqual([
      "Too long",
      "B",
    ]);
  });

  describe("remote files", () => {
    const HOST = "https://files.example.com";
    const down = (sourcePaths: SourcePath[]) => ({
      host: HOST,
      status: "unreachable" as const,
      details: "HEAD … → ECONNREFUSED",
      sourcePaths,
    });

    test("a host that is down is one row for every module it holds files of, first on the page", () => {
      const res = build({
        results: new Map<ModuleFilePath, ModuleCheckResult>([
          [
            BLOG,
            {
              status: "ok",
              errors: {},
              remoteHosts: [down([at(BLOG, '"a"'), at(BLOG, '"b"')])],
            },
          ],
          [
            MEDIA,
            {
              status: "ok",
              errors: { [at(MEDIA, '"x"')]: [{ message: "Required" }] },
              remoteHosts: [down([at(MEDIA, '"c"')])],
            },
          ],
        ]),
      });
      // BLOG has nothing wrong but its host, so it has no group of its own.
      expect(res.groups.map((group) => group.id)).toEqual([
        REMOTE_GROUP_ID,
        MEDIA,
      ]);
      const [hostRow] = res.groups[0].rows;
      expect(res.groups[0].rows).toHaveLength(1);
      expect(hostRow).toMatchObject({
        location: "files.example.com",
        message:
          "files.example.com could not be reached, so 3 remote files in 2 modules could not be checked.",
        details: "HEAD … → ECONNREFUSED",
        action: { kind: "try-again" },
      });
      expect(res.targets.get(hostRow.id)).toEqual({
        kind: "host",
        host: HOST,
        moduleFilePaths: [BLOG, MEDIA],
      });
      // The host is something to deal with; so is the module's own error.
      expect(openRowCount(res.groups)).toBe(2);
    });

    test("a stale remote ref can be fixed here", () => {
      const hero = at(MEDIA, '"hero"');
      const res = build({
        results: new Map<ModuleFilePath, ModuleCheckResult>([
          [
            MEDIA,
            {
              status: "ok",
              errors: {
                [hero]: [{ message: "Stale", fixes: ["image:check-remote"] }],
              },
              remoteHosts: [],
            },
          ],
        ]),
      });
      expect(res.groups.map((group) => group.id)).toEqual([MEDIA]);
      expect(res.groups[0].rows[0].action).toEqual({ kind: "fix" });
    });
  });
});

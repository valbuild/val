import {
  Internal,
  ModuleId,
  ModulePath,
  PatchId,
  SourcePath,
} from "@valbuild/core";
import { convertPatchErrors } from "./convertPatchErrors";

const moduleIds = ["/app/test", "/app/example"] as ModuleId[];
const patchIds = ["1707928555701", "1707928555702"] as PatchId[];
const modulePaths = ['1."test"', '1."example"'] as ModulePath[];
const sourcePaths = [
  `${moduleIds[0]}.${modulePaths[0]}`,
  `${moduleIds[1]}.${modulePaths[1]}`,
] as SourcePath[];

describe("convertPatchErrors", () => {
  test.skip("basics", () => {
    console.log(
      JSON.stringify(
        convertPatchErrors(
          {
            [moduleIds[0]]: [
              {
                author: "1",
                created_at: new Date(parseInt(patchIds[0])).toISOString(),
                patch_id: patchIds[0],
                patch: [
                  {
                    op: "replace",
                    path: Internal.createPatchPath(modulePaths[0]),
                    value: "test",
                  },
                  {
                    op: "replace",
                    path: Internal.createPatchPath(modulePaths[1]),
                    value: "test2",
                  },
                  {
                    op: "file",
                    path: Internal.createPatchPath(modulePaths[0]),
                    filePath: "/app/test",
                    value: "test2",
                  },
                ],
              },
              {
                author: "2",
                created_at: new Date(parseInt(patchIds[0])).toISOString(),
                patch_id: patchIds[1],
                patch: [
                  {
                    op: "replace",
                    path: Internal.createPatchPath(modulePaths[0]),
                    value: "tst",
                  },
                ],
              },
            ],
          },
          {
            validationErrors: {
              [moduleIds[0]]: {
                errors: {
                  validation: {
                    [sourcePaths[0]]: [
                      {
                        message:
                          "Text length is 3 characters: must be between 10 and 100 characters",
                      },
                      {
                        message:
                          "Text is 'Hello': must correspond to pattern 'CMS|Test'",
                      },
                    ],
                  },
                },
              },
            },
            modules: {
              [moduleIds[0]]: {
                patches: {
                  applied: [patchIds[0]],
                  failed: [patchIds[1]],
                },
              },
            },
          },
          {
            "1": {
              id: "1",
              name: "Test",
            },
            "2": {
              id: "2",
              name: "Test2",
            },
          }
        ),
        null,
        2
      )
    );
  });

  test("todo", () => {
    console.log(
      JSON.stringify(
        convertPatchErrors(
          {
            ["/app/content" as ModuleId]: [
              {
                patch_id: "1707740944795" as PatchId,
                patch: [
                  {
                    op: "add",
                    path: ["tags", "4"],
                    value: "",
                  },
                ],
                created_at: "2024-02-12T12:29:04.795Z",
              },
              {
                patch_id: "1707740952145" as PatchId,
                patch: [
                  {
                    op: "replace",
                    path: ["tags", "4"],
                    value: "CMS",
                  },
                ],
                created_at: "2024-02-12T12:29:12.145Z",
              },
              {
                patch_id: "1707741271448" as PatchId,
                patch: [
                  {
                    op: "add",
                    path: ["tags", "5"],
                    value: "",
                  },
                ],
                created_at: "2024-02-12T12:34:31.448Z",
              },
              {
                patch_id: "1707741275953" as PatchId,
                patch: [
                  {
                    op: "remove",
                    path: ["tags", "5"],
                  },
                ],
                created_at: "2024-02-12T12:34:35.953Z",
              },
              {
                patch_id: "1707742428935" as PatchId,
                patch: [
                  {
                    op: "replace",
                    path: ["text"],
                    value: {
                      templateStrings: [
                        "\nVal is a CMS where **content** is **code** in your git repo.\n\n<br />\n\nVal is a CMS, which is useful because:\n\n- editors can **change content** without developer interactions\n- **images** can be managed without checking in code\n- **i18n** suppordfast is easy to add\n- a **well-documented** way to **structure content**\n\n<br />\n\nBut, with all the benefits of having content hard-coded:\n\n- works as normal with your **favorite IDE** without any plugins: search for content, references to usages, ...\n- content is **type-checked** so you see when something is wrong immediately\n- content can be **refactored** (change names, etc) just as if it was hard-coded (because it sort of is)\n- work **locally** or in **branches** just as if you didn't use a CMS\n- **no need for code-gen** and extra build steps\n",
                      ],
                      exprs: [],
                      _type: "richtext",
                    },
                  },
                ],
                created_at: "2024-02-12T12:53:48.935Z",
              },
              {
                patch_id: "1707742433928" as PatchId,
                patch: [
                  {
                    op: "replace",
                    path: ["text"],
                    value: {
                      templateStrings: [
                        "\nVal is a CMS where **content** is **code** in your git repo.\n\n<br />\n\nVal is a CMS, which is useful because:\n\n- editors can **change content** without developer interactions\n- **images** can be managed without checking in code\n- **i18n** suppordfast is easy to add\n- a **well-documented** way to **structure content**\n\n<br />\n\nBut, with all the benefits of having content hard-coded:\n\n- works as normal with your **favorite IDE** without any plugins: search for content, references to usages, ...\n- content is **type-checked** so you see when something is wrong immediately\n- content can be **refactored** (change names, etc) just as if it was hard-coded (because it sort of is)\n- work **locally** or in **branches** just as if you didn't use a CMS\n- **no need for cofdsadfde-gen** and extra build steps\n",
                      ],
                      exprs: [],
                      _type: "richtext",
                    },
                  },
                ],
                created_at: "2024-02-12T12:53:53.928Z",
              },
              {
                patch_id: "1707742437918" as PatchId,
                patch: [
                  {
                    op: "replace",
                    path: ["text"],
                    value: {
                      templateStrings: [
                        "\nVal is a CMS where **content** is **code** in your git repo.\n\n<br />\n\nVal is a CMS, which is useful because:\n\n- editors can **change content** without developer interactions\n- **images** can be managed without checking in code\n- **i18n** suppordfast is easy to add\n- a **well-documented** way to **structure content**\n\n<br />\n\nBut, with all the benefits of having content hard-coded:\n\n- works as normal with your **favorite IDE** without any plugins: search for content, references to usages, ...\n- content is **type-checked** so you see when something is wrong immediately\n- content can be **refactored** (change names, etc) just as if it was hard-coded (because it sort of is)\n- work **locally** or in **branches** just as if you didn't use a CMS\n- **no need fadffor cofdsadfde-gen** and extra build steps\n",
                      ],
                      exprs: [],
                      _type: "richtext",
                    },
                  },
                ],
                created_at: "2024-02-12T12:53:57.918Z",
              },
              {
                patch_id: "1707742441572" as PatchId,
                patch: [
                  {
                    op: "replace",
                    path: ["text"],
                    value: {
                      templateStrings: [
                        "\nVal is a CMS where **content** is **code** in your git repo.\n\n<br />\n\nVal is a CMS, which is useful because:\n\n- editors can **change content** without developer interactions\n- **images** can be managed without checking in code\n- **i18n** suppordfast is easy to add\n- a **well-documented** way to **structure content**\n\n<br />\n\nBut, with all the benefits of having content hard-coded:\n\n- works as normal with your **favorite IDE** without any plugins: search for content, references to usages, ...\n- content is **type-checked** so you see when something is wrong immediately\n- content can be **refactored** (change names, etc) just as if it was hard-coded (because it sort of is)\n- work **locally** or in **branches** just as if you didn't use a CMS\n- **no need fadffor cofdsadfde-gen** and extra build stepfdass\n",
                      ],
                      exprs: [],
                      _type: "richtext",
                    },
                  },
                ],
                created_at: "2024-02-12T12:54:01.572Z",
              },
            ],
            ["/components/clientContent" as ModuleId]: [
              {
                patch_id: "1707742521155" as PatchId,
                patch: [
                  {
                    op: "replace",
                    path: ["text"],
                    value: "Jepp",
                  },
                ],
                created_at: "2024-02-12T12:55:21.155Z",
              },
              {
                patch_id: "1708335829764" as PatchId,
                patch: [
                  {
                    op: "replace",
                    path: ["text"],
                    value: "Test",
                  },
                ],
                created_at: "2024-02-19T09:43:49.764Z",
              },
            ],
          },
          {
            modules: {
              ["/app/content" as ModuleId]: {
                patches: {
                  applied: [
                    "1707740944795",
                    "1707740952145",
                    "1707741271448",
                    "1707741275953",
                    "1707742428935",
                    "1707742433928",
                    "1707742437918",
                    "1707742441572",
                  ] as PatchId[],
                },
              },
              ["/components/clientContent" as ModuleId]: {
                patches: {
                  applied: ["1707742521155", "1708335829764"] as PatchId[],
                },
              },
            },
            validationErrors: false,
          }
        ),
        null,
        2
      )
    );
  });
});

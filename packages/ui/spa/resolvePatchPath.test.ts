import { initVal, Internal } from "@valbuild/core";
import { resolvePatchPath } from "./resolvePatchPath";

const { c, s } = initVal();
const testModule1 = c.define(
  "/test1.val.ts",
  s.record(
    s.object({
      "2": s.array(
        s.union(
          "type",
          s.object({
            type: s.literal("type1"),
            "4": s.number(),
          }),
          s.object({
            type: s.literal("type2"),
            "4": s.array(s.string()),
          }),
          s.object({
            type: s.literal("type3"),
            image: s.image(),
          }),
        ),
      ),
    }),
  ),
  {
    "1": {
      "2": [
        { type: "type1", "4": 1 },
        { type: "type2", "4": ["zero"] },
        { type: "type2", "4": ["zero"] },
        { type: "type2", "4": ["zero", "one", "two", "three", "four", "five"] },
        {
          type: "type3",
          image: c.image("/public/val/test.png", {
            alt: "test",
            height: 100,
            width: 100,
          }),
        },
      ],
    },
  },
);
const testSchema1 = Internal.getSchema(testModule1)!["executeSerialize"]();
const testSource1 = Internal.getSource(testModule1);

describe("resolvePatchPath", () => {
  test("basics level 1", () => {
    expect(resolvePatchPath(["1"], testSchema1, testSource1)).toMatchObject({
      modulePath: `"1"`,
      schema: {
        type: "object",
      },
      source: {
        "2": [
          { type: "type1", "4": 1 },
          { type: "type2", "4": ["zero"] },
          { type: "type2", "4": ["zero"] },
          {
            type: "type2",
            "4": ["zero", "one", "two", "three", "four", "five"],
          },
          {
            type: "type3",
            image: c.image("/public/val/test.png", {
              alt: "test",
              height: 100,
              width: 100,
            }),
          },
        ],
      },
    });
  });

  test("basics level 2", () => {
    expect(
      resolvePatchPath(["1", "2"], testSchema1, testSource1),
    ).toMatchObject({
      modulePath: `"1"."2"`,
      schema: {
        type: "array",
      },
      source: [
        { type: "type1", "4": 1 },
        { type: "type2", "4": ["zero"] },
        { type: "type2", "4": ["zero"] },
        {
          type: "type2",
          "4": ["zero", "one", "two", "three", "four", "five"],
        },
        {
          type: "type3",
          image: c.image("/public/val/test.png", {
            alt: "test",
            height: 100,
            width: 100,
          }),
        },
      ],
    });
  });

  test("basics level 3", () => {
    expect(
      resolvePatchPath(["1", "2", "3"], testSchema1, testSource1),
    ).toMatchObject({
      modulePath: `"1"."2".3`,
      schema: {
        type: "union",
      },
      source: {
        type: "type2",
        "4": ["zero", "one", "two", "three", "four", "five"],
      },
    });
  });

  test("basics level 4", () => {
    expect(
      resolvePatchPath(["1", "2", "3", "4"], testSchema1, testSource1),
    ).toMatchObject({
      modulePath: `"1"."2".3."4"`,
      schema: {
        type: "array",
      },
      source: ["zero", "one", "two", "three", "four", "five"],
    });
  });

  test("basics level 5", () => {
    expect(
      resolvePatchPath(["1", "2", "3", "4", "5"], testSchema1, testSource1),
    ).toMatchObject({
      modulePath: `"1"."2".3."4".5`,
      schema: {
        type: "string",
      },
      source: "five",
    });
  });

  test("basics image", () => {
    expect(
      resolvePatchPath(["1", "2", "4", "image"], testSchema1, testSource1),
    ).toMatchObject({
      modulePath: `"1"."2".4."image"`,
      schema: {
        type: "image",
      },
      source: c.image("/public/val/test.png", {
        alt: "test",
        height: 100,
        width: 100,
      }),
    });
  });

  test("basics image alt", () => {
    expect(
      resolvePatchPath(
        ["1", "2", "4", "image", "metadata", "alt"],
        testSchema1,
        testSource1,
      ),
    ).toMatchObject({
      modulePath: `"1"."2".4."image"."metadata"."alt"`,
      schema: {
        type: "image",
      },
      source: "test",
    });
  });

  test("richtext anchor href", () => {
    const richtextModule = c.define(
      "/test-richtext.val.ts",
      s.record(
        s.object({
          text: s.richtext({
            style: { bold: true, italic: true, lineThrough: true },
            block: { h2: true, ul: true },
            inline: { a: true },
          }),
        }),
      ),
      {
        "/": {
          text: [
            {
              tag: "p",
              children: [
                "Visit ",
                {
                  tag: "a",
                  href: "https://val.build",
                  children: ["Val"],
                },
                " for more information.",
              ],
            },
          ],
        },
      },
    );
    const richtextSchema =
      Internal.getSchema(richtextModule)!["executeSerialize"]();
    const richtextSource = Internal.getSource(richtextModule);

    expect(
      resolvePatchPath(
        ["/", "text", "0", "children", "1", "href"],
        richtextSchema,
        richtextSource,
      ),
    ).toMatchObject({
      modulePath: `"/"."text"`,
      schema: {
        type: "richtext",
      },
      source: "https://val.build",
    });
  });
});

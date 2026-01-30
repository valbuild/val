import type { Meta, StoryObj } from "@storybook/react";
import { Compare } from "./Compare";
import { comparePatchSets } from "../utils/comparePatchSets";
import { PatchSets } from "../utils/PatchSets";
import { initVal, Json, ModuleFilePath, PatchId } from "@valbuild/core";
import { applyPatch, deepClone, JSONOps, Patch } from "@valbuild/core/patch";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { useState } from "react";

type TestPatch = {
  patchId: string;
  patch: Patch;
  createdAt: string;
  author: string | null;
};

// Helper to apply patches and generate PatchSets
function applyPatchesAndGetSets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  beforeSource: Json,
  patches: TestPatch[],
  moduleFilePath: ModuleFilePath = "/test.val.ts" as ModuleFilePath,
) {
  const patchSets = new PatchSets();
  const serializedSchema = schema["executeSerialize"]();
  let currentSource = beforeSource;
  const jsonOps = new JSONOps();

  for (const testPatch of patches) {
    for (const op of testPatch.patch) {
      patchSets.insert(
        moduleFilePath,
        serializedSchema,
        op,
        testPatch.patchId as PatchId,
        testPatch.createdAt,
        testPatch.author,
      );
    }
    const patchResult = applyPatch(
      deepClone(currentSource),
      jsonOps,
      testPatch.patch,
    );
    if (patchResult.kind === "ok") {
      currentSource = patchResult.value;
    } else {
      throw new Error(
        `Failed to apply patch: ${JSON.stringify(patchResult.error)}`,
      );
    }
  }

  return { patchSets, afterSource: currentSource, serializedSchema };
}

const meta: Meta<typeof Compare> = {
  title: "Components/Compare",
  component: Compare,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => {
      const [theme, setTheme] = useState<Themes | null>(null);
      return (
        <ValThemeProvider theme={theme} setTheme={setTheme} config={undefined}>
          <div className="max-w-4xl mx-auto p-6">
            <Story />
          </div>
        </ValThemeProvider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const NestedDiscriminatedUnion: Story = {
  name: "Nested Discriminated Union with Images",
  render: () => {
    const { s, c } = initVal();

    // Create a complex nested schema with discriminated unions
    const schema = s.object({
      items: s.array(
        s.union(
          "kind",
          s.object({
            kind: s.literal("section"),
            title: s.string(),
            blocks: s.array(
              s.union(
                "type",
                s.object({
                  type: s.literal("paragraph"),
                  text: s.string(),
                }),
                s.object({
                  type: s.literal("image"),
                  url: s.string(),
                  alt: s.string(),
                }),
                s.object({
                  type: s.literal("image-file"),
                  image: s.image(),
                }),
                s.object({
                  type: s.literal("code"),
                  language: s.string(),
                  code: s.string(),
                }),
              ),
            ),
          }),
          s.object({
            kind: s.literal("divider"),
            style: s.string(),
          }),
          s.object({
            kind: s.literal("callout"),
            type: s.string(),
            message: s.string(),
          }),
        ),
      ),
    });

    const beforeSource: Json = {
      items: [
        {
          kind: "section",
          title: "Introduction",
          blocks: [
            { type: "paragraph", text: "Welcome to our documentation." },
            {
              type: "image",
              url: "/images/old-banner.png",
              alt: "Old banner",
            },
            {
              type: "image-file",
              image: c.file("/public/val/old-image.jpg", {
                width: 800,
                height: 600,
                mimeType: "image/jpeg",
              }),
            },
          ],
        },
        {
          kind: "callout",
          type: "info",
          message: "This is important information.",
        },
        {
          kind: "section",
          title: "Getting Started",
          blocks: [
            {
              type: "paragraph",
              text: "Follow these steps to get started.",
            },
            {
              type: "code",
              language: "javascript",
              code: "const x = 42;",
            },
          ],
        },
      ],
    };

    const patches: TestPatch[] = [
      {
        patchId: "patch1",
        patch: [
          {
            op: "replace",
            path: ["items", "0", "blocks", "1", "url"],
            value: "/images/new-banner.png",
          },
        ],
        createdAt: "2026-01-30T10:00:00Z",
        author: "alice@example.com",
      },
      {
        patchId: "patch2",
        patch: [
          {
            op: "replace",
            path: ["items", "0", "blocks", "1", "alt"],
            value: "New banner image",
          },
        ],
        createdAt: "2026-01-30T10:05:00Z",
        author: "alice@example.com",
      },
      {
        patchId: "patch2b",
        patch: [
          {
            op: "replace",
            path: ["items", "0", "blocks", "2", "image"],
            value: c.file("/public/val/new-image.jpg", {
              width: 1200,
              height: 800,
              mimeType: "image/jpeg",
            }),
          },
        ],
        createdAt: "2026-01-30T10:06:00Z",
        author: "alice@example.com",
      },
      {
        patchId: "patch3",
        patch: [
          {
            op: "replace",
            path: ["items", "2", "blocks", "1", "code"],
            value: "const x = 100;\\nconsole.log(x);",
          },
        ],
        createdAt: "2026-01-30T10:10:00Z",
        author: "bob@example.com",
      },
      {
        patchId: "patch4",
        patch: [
          {
            op: "replace",
            path: ["items", "1", "message"],
            value: "This is CRITICAL information!",
          },
        ],
        createdAt: "2026-01-30T10:15:00Z",
        author: "carol@example.com",
      },
    ];

    const { patchSets, afterSource, serializedSchema } =
      applyPatchesAndGetSets(schema, beforeSource, patches);

    const comparisons = comparePatchSets(
      serializedSchema,
      patchSets.serialize(),
      beforeSource,
      afterSource,
    );

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">
            Nested Discriminated Union Changes
          </h2>
          <p className="text-text-secondary">
            This example shows changes in a complex nested structure with
            discriminated unions. The schema contains an array of sections with
            different block types (paragraph, image, code) and other item types
            (divider, callout).
          </p>
        </div>
        <Compare comparisons={comparisons} />
      </div>
    );
  },
};

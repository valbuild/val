import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  type Json,
  type ModuleFilePath,
  type ReifiedPreview,
  type SerializedSchema,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import type { ValClient } from "@valbuild/shared/internal";
import { useMemo, useState } from "react";
import { ReviewCompare } from "../review/ReviewCompare";
import { PatchSets } from "../utils/PatchSets";
import { createStorySystem } from "../stores/react/storySystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { ValProvider } from "../components/ValProvider";
import { ValErrorProvider } from "../components/ValErrorProvider";
import { ValPortalProvider } from "../components/ValPortalProvider";
import { ValFieldProvider } from "../components/ValFieldProvider";
import { ValRemoteProvider } from "../components/ValRemoteProvider";
import { ValRouter } from "../components/ValRouter";
import { TooltipProvider } from "../components/designSystem/tooltip";
import type { Themes } from "../components/ValThemeProvider";

/**
 * A gallery change, in the compare dialog the review page and a proposal's
 * "Compare with the site" both open.
 *
 * Unlike `CompareDialog.stories`, nothing here is a fixture of the dialog's
 * model: a real `s.imagedir()` module is loaded into a story system, real
 * patches are applied to it, and `ReviewCompare` builds the model and renders
 * every cell through `CompareValue`, exactly as the Studio does. That is the
 * point -- the bug these stories pin was in that last step. A gallery entry's
 * schema is its METADATA, so an added image rendered as a width, a height and
 * a mime type, with no picture.
 *
 * The refs point at the sample images in `public/`, which Storybook serves, so
 * the thumbnails are real pixels. The patches carry no `file` op: with one,
 * the "after" URL would name the patch holding the bytes, which only a Val
 * server can answer.
 */

const { s, c } = initVal();

const GALLERY = "/content/images.val.ts" as ModuleFilePath;

const galleryModule = c.define(
  "/content/images.val.ts",
  s.imagedir("/public", { accept: "image/jpeg" }),
  {
    "/public/sample-image-3.jpg": {
      width: 1200,
      height: 800,
      mimeType: "image/jpeg",
      alt: "Hero banner",
      hotspot: { x: 0.5, y: 0.3 },
    },
    "/public/sample-image-2.jpg": {
      width: 600,
      height: 800,
      mimeType: "image/jpeg",
      alt: "Company logo",
    },
  },
);

function storeDataOf(
  modules: ReturnType<ReturnType<typeof initVal>["c"]["define"]>[],
) {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Json> = {};
  const previews: Record<ModuleFilePath, ReifiedPreview> = {};
  for (const module of modules) {
    const valPath = Internal.getValPath(module);
    const schema = Internal.getSchema(module);
    const source = Internal.getSource(module);
    if (valPath && schema && source !== undefined) {
      const [moduleFilePath] =
        Internal.splitModuleFilePathAndModulePath(valPath);
      schemas[moduleFilePath] = schema["executeSerialize"]();
      sources[moduleFilePath] = source;
      previews[moduleFilePath] = schema["executePreview"](
        moduleFilePath,
        source,
      );
    }
  }
  return { schemas, sources, previews };
}

const storeData = storeDataOf([galleryModule]);

/** Answers whatever `ValProvider` asks on mount; nothing here is saved. */
function createMockClient(): ValClient {
  return (() =>
    Promise.resolve({
      status: 200,
      json: { schemas: {}, sources: {}, config: { project: "storybook" } },
    })) as unknown as ValClient;
}

function Harness({
  patches,
}: {
  /** In chain order, each by its own author. */
  patches: { patch: Patch; author: string }[];
}) {
  const [theme, setTheme] = useState<Themes | null>("dark");
  const client = useMemo(() => createMockClient(), []);
  const { system, patchSets } = useMemo(() => {
    const system = createStorySystem(storeData);
    const sets = new PatchSets();
    for (const [i, { patch, author }] of patches.entries()) {
      const patchId = system.patchStore.mintPatchId();
      /*
       * Synchronous up to the point that matters: a patch without file bytes
       * is applied to the source before `createPatch` first awaits, so the
       * system is complete by the end of this loop.
       */
      void system.patchStore.createPatch(
        GALLERY,
        patch,
        undefined,
        undefined,
        undefined,
        patchId,
      );
      sets.insert(
        GALLERY,
        storeData.schemas[GALLERY],
        patch,
        patchId,
        `2026-10-${String(20 + i).padStart(2, "0")}T10:00:00Z`,
        author,
      );
    }
    return { system, patchSets: sets.serialize() };
  }, [patches]);
  const getDirectFileUploadSettings = useMemo(
    () => async () => ({
      status: "success" as const,
      data: {
        nonce: null,
        baseUrl: "https://mock-upload.example.com",
        contentBaseUrl: null,
        contentAuthNonce: null,
      },
    }),
    [],
  );

  return (
    <ValSystemProvider system={system}>
      <TooltipProvider>
        <ValRouter>
          <ValProvider
            client={client}
            config={null}
            dispatchValEvents={false}
            theme={theme}
            setTheme={setTheme}
          >
            {/*
             * Again, inside: `ValProvider` mounts a system of its own, built
             * from the mock client, which never initialises. Every field below
             * would read from that one and stay loading.
             */}
            <ValSystemProvider system={system}>
              <ValErrorProvider>
                <ValPortalProvider>
                  <ValFieldProvider
                    getDirectFileUploadSettings={getDirectFileUploadSettings}
                    config={undefined}
                  >
                    <ValRemoteProvider
                      remoteFiles={{
                        status: "inactive",
                        message: "Storybook mock",
                        reason: "project-not-configured",
                      }}
                    >
                      <div className="h-screen w-full bg-bg-secondary">
                        <ReviewCompare
                          open
                          onOpenChange={() => undefined}
                          patchSets={patchSets}
                          mode="http"
                          currentAuthorId="alice"
                          focusSourcePath={null}
                          onUndo={() => undefined}
                        />
                      </div>
                    </ValRemoteProvider>
                  </ValFieldProvider>
                </ValPortalProvider>
              </ValErrorProvider>
            </ValSystemProvider>
          </ValProvider>
        </ValRouter>
      </TooltipProvider>
    </ValSystemProvider>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Compare/Gallery change",
  component: Harness,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof Harness>;

/**
 * A new image in the gallery: the picture on the right, with its file name,
 * size and alt text, and "did not exist" on the left.
 */
export const ImageAdded: Story = {
  args: {
    patches: [
      {
        author: "alice",
        patch: [
          {
            op: "add",
            path: ["/public/sample-image-1.jpg"],
            value: {
              width: 800,
              height: 600,
              mimeType: "image/jpeg",
              alt: "A sunset over the mountains",
            },
          },
        ],
      },
    ],
  },
};

/** An image taken out of the gallery: the picture on the left only. */
export const ImageRemoved: Story = {
  args: {
    patches: [
      {
        author: "bob",
        patch: [{ op: "remove", path: ["/public/sample-image-2.jpg"] }],
      },
    ],
  },
};

/**
 * Several gallery changes in one publish: one added (with a focal point), one
 * removed, and one whose alt text was edited.
 *
 * The edited one is a row for `alt`, not for the image: a change inside an
 * entry is a change to that field, and the picture is shown where the change
 * was to the file itself.
 */
export const MixedChanges: Story = {
  args: {
    patches: [
      {
        author: "alice",
        patch: [
          {
            op: "add",
            path: ["/public/sample-image-1.jpg"],
            value: {
              width: 800,
              height: 600,
              mimeType: "image/jpeg",
              alt: "A sunset over the mountains",
              hotspot: { x: 0.3, y: 0.6 },
            },
          },
        ],
      },
      {
        author: "bob",
        patch: [{ op: "remove", path: ["/public/sample-image-2.jpg"] }],
      },
      {
        author: "alice",
        patch: [
          {
            op: "replace",
            path: ["/public/sample-image-3.jpg", "alt"],
            value: "Hero banner, cropped for the landing page",
          },
        ],
      },
    ],
  },
};

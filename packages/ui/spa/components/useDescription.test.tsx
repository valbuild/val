/**
 * @jest-environment jsdom
 */
import "../stores/react/testPolyfills";
import { act, render, screen } from "@testing-library/react";
import {
  initVal,
  Internal,
  type ModuleFilePath,
  type SelectorSource,
  type SourcePath,
  type ValModule,
} from "@valbuild/core";
import React from "react";
import { createStorySystem } from "../stores/react/storySystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { ValFieldProvider, useValField } from "./ValFieldProvider";
import { useDescription } from "./useDescription";

jest.mock("../validation/schemaValidationBridge", () => ({
  createSchemaValidationBridge: () => ({
    validate: async () => ({ errors: false }),
    dispose: () => {},
  }),
}));

const { s, c } = initVal();

/**
 * The case the whole thing exists for: a MODULE ROOT with a `.preview(...)`.
 *
 * It has no container, so nothing reified it and the studio could only ever
 * show the file name — `Footer`. `executePreview` now emits a self preview at
 * the module's own path, and `useDescription` reads it.
 */
const footer = c.define(
  "/components/footer.val.ts",
  s.array(s.object({ title: s.string() })).preview(({ val }) => ({
    title: "Footer links",
    subtitle: `${val.length} groups`,
  })),
  [{ title: "Community" }, { title: "Legal" }],
);

/** The same module with no `.preview()` at all — the fallback floor. */
const unnamedFooter = c.define(
  "/components/footer.val.ts",
  s.array(s.object({ title: s.string() })),
  [{ title: "Community" }],
);

function Providers({
  children,
  module: forModule,
}: {
  children: React.ReactNode;
  module: ValModule<SelectorSource>;
}) {
  const filePath = Internal.getValPath(forModule) as unknown as ModuleFilePath;
  const forSchema = Internal.getSchema(forModule)!;
  const system = createStorySystem({
    schemas: { [filePath]: forSchema["executeSerialize"]() },
    sources: { [filePath]: Internal.getSource(forModule) },
    previews: {
      [filePath]: forSchema["executePreview"](
        filePath,
        Internal.getSource(forModule),
      ),
    },
  });
  return (
    <ValSystemProvider system={system}>
      <ValFieldProvider
        getDirectFileUploadSettings={async () => ({
          status: "success" as const,
          data: {
            nonce: null,
            baseUrl: "https://mock-upload.example.com",
            contentBaseUrl: null,
            contentAuthNonce: null,
          },
        })}
        config={undefined}
      >
        {children}
      </ValFieldProvider>
    </ValSystemProvider>
  );
}

const modulePath = "/components/footer.val.ts" as unknown as SourcePath;

function Heading() {
  // The field's own subscription is the demand signal that makes the preview
  // store compute — the same shape the module editor has.
  useValField(modulePath, "array", { watchUnsaved: true });
  return <Described />;
}

function Described() {
  const description = useDescription(modulePath);
  return (
    <div data-testid="described">
      {JSON.stringify({
        title: description.title,
        subtitle: description.subtitle,
        pathLabel: description.pathLabel,
        origin: description.origin.title,
      })}
    </div>
  );
}

async function renderFor(module: ValModule<SelectorSource>) {
  render(
    <Providers module={module}>
      <Heading />
    </Providers>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return JSON.parse(screen.getByTestId("described").textContent || "null");
}

test("a module root is named by its own `.preview()`", async () => {
  expect(await renderFor(footer)).toEqual({
    title: "Footer links",
    subtitle: "2 groups",
    pathLabel: "Footer",
    origin: "preview",
  });
});

test("a module root with no preview falls back to its file name", async () => {
  expect(await renderFor(unnamedFooter)).toEqual({
    title: "Footer",
    subtitle: null,
    pathLabel: "Footer",
    origin: "fallback",
  });
});

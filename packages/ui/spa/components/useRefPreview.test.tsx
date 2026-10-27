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
import { useRefPreview } from "./useRefPreview";

jest.mock("../validation/schemaValidationBridge", () => ({
  createSchemaValidationBridge: () => ({
    validate: async () => ({ errors: false }),
    dispose: () => {},
  }),
}));

const { s, c } = initVal();

/**
 * The container is deliberately NOT at the module root: its path segment is a
 * quoted key (`?p="testimonials"`). `useParent` used to rebuild the parent
 * path by joining UNQUOTED segments (`?p=testimonials`), so the preview lookup
 * inside `useRefPreview` missed for every nested container while the schema
 * lookup happened to tolerate it — rows silently fell back to the generic
 * preview instead of the container's `.preview(...)`.
 */
const mod = c.define(
  "/content/testimonials.val.ts",
  s.object({
    testimonials: s.array(
      s
        .object({ quote: s.string(), name: s.string() })
        .preview(({ val }) => ({ title: val.name, subtitle: val.quote })),
    ),
  }),
  {
    testimonials: [
      { quote: "Q1", name: "Ada" },
      { quote: "Q2", name: "Grace" },
    ],
  },
);

const moduleFilePath = Internal.getValPath(mod) as unknown as ModuleFilePath;
const containerPath =
  `${moduleFilePath}?p=${JSON.stringify("testimonials")}` as SourcePath;
const rowPath = `${containerPath}.0` as SourcePath;

function Providers({
  children,
  module: forModule = mod,
}: {
  children: React.ReactNode;
  /** Which fixture to build the story system from; the array one by default. */
  module?: ValModule<SelectorSource>;
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

function List() {
  // The list field's own subscription is the demand signal that makes the
  // preview store compute — the same shape as ArrayFields/SortableList.
  useValField(containerPath, "array", { watchUnsaved: true });
  return <Row />;
}

function Row() {
  const preview = useRefPreview(rowPath);
  return <div data-testid="row">{JSON.stringify(preview) ?? ""}</div>;
}

test("useRefPreview resolves a nested container's preview for a row", async () => {
  render(
    <Providers>
      <List />
    </Providers>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(JSON.parse(screen.getByTestId("row").textContent || "null")).toEqual({
    title: "Ada",
    subtitle: "Q1",
  });
});

/**
 * A record whose keys LOOK like array indices. `splitModulePath` hands back
 * `"0"` for both an array index and this key, so a parent path rebuilt by
 * re-quoting from the text alone (`patchPathToModulePath`) emits it unquoted
 * and points at nothing — the row falls back to the generic preview. The
 * parent path is sliced out of the original string instead, which keeps
 * whatever quoting it already had.
 */
const numericKeyMod = c.define(
  "/content/numericKeys.val.ts",
  s.object({
    entries: s.record(
      s
        .object({ name: s.string() })
        .preview(({ val }) => ({ title: val.name })),
    ),
  }),
  { entries: { "0": { name: "Zero" }, "1": { name: "One" } } },
);

const numericKeyFilePath = Internal.getValPath(
  numericKeyMod,
) as unknown as ModuleFilePath;
const numericKeyContainerPath =
  `${numericKeyFilePath}?p=${JSON.stringify("entries")}` as SourcePath;
const numericKeyRowPath =
  `${numericKeyContainerPath}.${JSON.stringify("0")}` as SourcePath;

function NumericKeyList() {
  useValField(numericKeyContainerPath, "record", { watchUnsaved: true });
  return <NumericKeyRow />;
}

function NumericKeyRow() {
  const preview = useRefPreview(numericKeyRowPath);
  return <div data-testid="numeric-row">{JSON.stringify(preview) ?? ""}</div>;
}

test("useRefPreview resolves a preview for a numeric-looking record key", async () => {
  render(
    <Providers module={numericKeyMod}>
      <NumericKeyList />
    </Providers>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(
    JSON.parse(screen.getByTestId("numeric-row").textContent || "null"),
  ).toEqual({ title: "Zero" });
});

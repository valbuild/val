/**
 * @jest-environment jsdom
 */
import "../stores/react/testPolyfills";
import { act, render, screen } from "@testing-library/react";
import {
  initVal,
  Internal,
  type ModuleFilePath,
  type SourcePath,
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
    testimonials: s
      .array(s.object({ quote: s.string(), name: s.string() }))
      .preview(({ val }) => ({ title: val.name, subtitle: val.quote })),
  }),
  {
    testimonials: [
      { quote: "Q1", name: "Ada" },
      { quote: "Q2", name: "Grace" },
    ],
  },
);

const moduleFilePath = Internal.getValPath(mod) as unknown as ModuleFilePath;
const schema = Internal.getSchema(mod)!;
const containerPath =
  `${moduleFilePath}?p=${JSON.stringify("testimonials")}` as SourcePath;
const rowPath = `${containerPath}.0` as SourcePath;

function Providers({ children }: { children: React.ReactNode }) {
  const system = createStorySystem({
    schemas: { [moduleFilePath]: schema["executeSerialize"]() },
    sources: { [moduleFilePath]: Internal.getSource(mod) },
    previews: {
      [moduleFilePath]: schema["executePreview"](
        moduleFilePath,
        Internal.getSource(mod),
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

/** @jest-environment jsdom */
// FIRST, and it must stay first: the field pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  Internal,
  ModuleFilePath,
  SourcePath,
  initVal,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";

/**
 * Adding an entry to the REFERENCED module from the site of the reference.
 *
 * Which module each write lands in is the whole claim: selecting a key writes
 * to the field, but creating one has to write to the module the key belongs
 * to - `addModuleFilePatch`, not `addPatch`. A version that added the key to
 * the referring module instead type-checks, looks right on screen until the
 * source comes back, and quietly writes an entry nobody can reference.
 */
const { s, c } = initVal();

const mockSchemas = jest.fn();
const mockSources = jest.fn();
const mockAddPatch = jest.fn();
const mockAddModuleFilePatch = jest.fn();
const mockNavigate = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useSchemaAtPath: (path: string) => mockSchemas()[path],
  useShallowSourceAtPath: (path: string) => mockSources()[path],
  usePreviewAtPath: () => undefined,
  useAddPatch: () => ({
    patchPath: ["author"],
    addPatch: mockAddPatch,
    addModuleFilePatch: mockAddModuleFilePatch,
  }),
}));

jest.mock("../ValPortalProvider", () => ({
  __esModule: true,
  useValPortal: () => null,
}));

jest.mock("../../components/ValRouter", () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// The generic dispatchers, which would otherwise drag in the whole field tree
// (and, through `ValProvider`, a worker URL jest cannot parse).
jest.mock("../AnyField", () => ({
  __esModule: true,
  AnyField: () => <div data-testid="any-field" />,
}));

jest.mock("../../components/Preview", () => ({
  __esModule: true,
  PreviewLoading: () => <div data-testid="preview-loading" />,
  PreviewNull: () => <div data-testid="preview-null" />,
}));

import { KeyOfField } from "./KeyOfField";

const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;
const FIELD = '/content/blog.val.ts?p="author"' as SourcePath;

/** The serialized schema and source the Studio actually has for a module. */
function serialize(valModule: ReturnType<typeof c.define>) {
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
  if (!schema) throw new Error("Schema not found");
  return {
    schema: schema as SerializedSchema,
    source: Internal.getSource(valModule) as Source,
  };
}

const authorsRecord = serialize(
  c.define(
    AUTHORS,
    s.record(s.object({ name: s.string(), title: s.string() })),
    { freekh: { name: "Fredrik Ekholdt", title: "CTO" } },
  ),
);
const authorsObject = serialize(
  c.define(AUTHORS, s.object({ freekh: s.string(), teddy: s.string() }), {
    freekh: "Fredrik Ekholdt",
    teddy: "Theodor René Carlsen",
  }),
);

function mount(
  referenced: { schema: SerializedSchema; source: Source },
  options?: { selected?: string | null; readonly?: boolean; inline?: boolean },
) {
  mockSchemas.mockReturnValue({
    [FIELD]: {
      status: "success",
      data: {
        type: "keyOf",
        path: AUTHORS,
        schema:
          referenced.schema.type === "record"
            ? { type: "record" }
            : { type: "object", keys: ["freekh", "teddy"] },
        opt: false,
        values: "string",
        render: options?.inline ? { as: "inline" } : undefined,
      },
    },
    [AUTHORS]: { status: "success", data: referenced.schema },
  });
  mockSources.mockReturnValue({
    [FIELD]: { status: "success", data: options?.selected ?? null },
    [AUTHORS]: { status: "success", data: referenced.source },
  });
  return render(<KeyOfField path={FIELD} readonly={options?.readonly} />);
}

function openDropdown() {
  fireEvent.click(screen.getByRole("combobox"));
}

beforeEach(() => {
  jest.clearAllMocks();
  // What cmdk needs from a browser and jsdom does not have: it measures the
  // list, and scrolls the active item into view.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = jest.fn();
});

describe("KeyOfField", () => {
  it("adds the new entry to the referenced module, and references it", () => {
    mount(authorsRecord, { selected: "freekh" });
    openDropdown();

    fireEvent.click(screen.getByText("New entry"));
    fireEvent.change(screen.getByPlaceholderText("Key"), {
      target: { value: "sindre" },
    });
    fireEvent.click(screen.getByText("Create"));

    // The entry goes to the authors module, built from ITS item schema.
    expect(mockAddModuleFilePatch).toHaveBeenCalledWith(
      AUTHORS,
      [{ op: "add", path: ["sindre"], value: { name: "", title: "" } }],
      "record",
    );
    // ...the field now points at it, which is what the editor came for...
    expect(mockAddPatch).toHaveBeenCalledWith(
      [{ op: "replace", path: ["author"], value: "sindre" }],
      "keyOf",
    );
    // ...and the editor is taken to the entry, which is empty until they say
    // who this author is.
    expect(mockNavigate).toHaveBeenCalledWith(`${AUTHORS}?p="sindre"`);
  });

  it("stays put when the referenced entry renders inline", () => {
    mount(authorsRecord, { inline: true });
    openDropdown();
    fireEvent.click(screen.getByText("New entry"));
    fireEvent.change(screen.getByPlaceholderText("Key"), {
      target: { value: "sindre" },
    });
    fireEvent.click(screen.getByText("Create"));

    // The entry is rendered under the selector, so it was created and
    // referenced without going anywhere: navigating away from it is the one
    // thing an inline render exists to avoid.
    expect(mockAddModuleFilePatch).toHaveBeenCalled();
    expect(mockAddPatch).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("reaches the same form from the + beside the dropdown", () => {
    mount(authorsRecord, { selected: "freekh" });

    // Without opening the list first: the second entry point exists for the
    // editor who has not opened it.
    fireEvent.click(screen.getByRole("button", { name: "New entry" }));
    fireEvent.change(screen.getByPlaceholderText("Key"), {
      target: { value: "sindre" },
    });
    fireEvent.click(screen.getByText("Create"));

    expect(mockAddModuleFilePatch).toHaveBeenCalledWith(
      AUTHORS,
      [{ op: "add", path: ["sindre"], value: { name: "", title: "" } }],
      "record",
    );
  });

  it("starts the new key from what was searched for", () => {
    mount(authorsRecord);
    openDropdown();
    fireEvent.change(screen.getByPlaceholderText("Search key..."), {
      target: { value: "sindre" },
    });
    // The search matched nothing, which is exactly when creating is wanted, so
    // the option has to still be there (`forceMount`).
    fireEvent.click(screen.getByText("New entry"));

    expect(screen.getByPlaceholderText<HTMLInputElement>("Key").value).toBe(
      "sindre",
    );
  });

  it("refuses a key that already exists, rather than overwriting that entry", () => {
    mount(authorsRecord);
    openDropdown();
    fireEvent.click(screen.getByText("New entry"));
    fireEvent.change(screen.getByPlaceholderText("Key"), {
      target: { value: "freekh" },
    });

    expect(screen.getByText("This key already exists")).toBeDefined();
    fireEvent.click(screen.getByText("Create"));
    expect(mockAddModuleFilePatch).not.toHaveBeenCalled();
    expect(mockAddPatch).not.toHaveBeenCalled();
  });

  it("offers no create option for an object reference: its keys ARE its schema", () => {
    mount(authorsObject, { selected: "freekh" });
    openDropdown();

    // The dropdown IS open: the object's keys are listed, there is just no way
    // to add one.
    expect(screen.getByText("teddy")).toBeDefined();
    expect(screen.queryByText("New entry")).toBeNull();
  });

  it("offers no create option when the field is readonly", () => {
    mount(authorsRecord, { selected: "freekh", readonly: true });
    openDropdown();

    expect(screen.queryByText("New entry")).toBeNull();
    expect(screen.queryByRole("button", { name: "New entry" })).toBeNull();
  });
});

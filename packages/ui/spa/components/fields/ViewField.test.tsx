/** @jest-environment jsdom */
// FIRST, and it must stay first: the field pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  initVal,
  ModuleFilePath,
  SerializedSchema,
  SerializedValViewSchema,
  SourcePath,
} from "@valbuild/core";

/**
 * A view row is decided by the VIEW's flags, never by the module it names.
 *
 * The case this exists for: `employees.val.ts` is a `keyOf` target that a dozen
 * modules point into, so it is `hidden` and the Explorer does not list it — but
 * it is also the content of `/menneskene`, which reaches it through a view. If
 * the row inherited the target's `hidden` there would be no way in at all, and
 * if it inherited the target's `readonly` a shared module would silently
 * disable a row that only navigates.
 */
const mockTargetSchema = jest.fn();
const mockNavigate = jest.fn();
const mockSourceAtPath = jest.fn();
/** What `FieldSourceError` was handed as its `schema`, for the repair case. */
let sourceErrorProps: unknown;

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  // Schema-only, by MODULE path: the row must not peek or demand the target's
  // source, which is what `useSchemaAtPath` would have done.
  useModuleSchemaRemote: (moduleFilePath: ModuleFilePath) =>
    mockTargetSchema(moduleFilePath),
  useShallowSourceAtPath: () => mockSourceAtPath(),
}));
jest.mock("../ValRouter", () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate }),
}));
// Reached only by the error branches, and each drags in the store tree.
jest.mock("../FieldLoading", () => ({
  __esModule: true,
  FieldLoading: () => <div data-testid="loading" />,
}));
jest.mock("../FieldNotFound", () => ({
  __esModule: true,
  FieldNotFound: () => <div data-testid="not-found" />,
}));
jest.mock("../FieldSchemaError", () => ({
  __esModule: true,
  FieldSchemaError: () => <div data-testid="schema-error" />,
}));
jest.mock("../FieldSourceError", () => ({
  __esModule: true,
  FieldSourceError: ({ schema }: { schema?: unknown }) => {
    sourceErrorProps = schema;
    return <div data-testid="source-error" />;
  },
}));

import { ViewField } from "./ViewField";

const { s } = initVal();

const PATH = '/app/menneskene/page.val.ts?p="people"' as SourcePath;
const TARGET = "/data/employees.val.ts" as ModuleFilePath;

const viewSchema: SerializedValViewSchema = {
  type: "view",
  opt: false,
  moduleFilePath: TARGET,
  readonly: false,
  hidden: false,
};

/** Mount the row over a target module with the given schema. */
function mount(targetSchema: SerializedSchema) {
  mockTargetSchema.mockImplementation(() => ({
    status: "success",
    data: targetSchema,
  }));
  return render(<ViewField path={PATH} schema={viewSchema} />);
}

const employees = s.record(s.object({ name: s.string() }));

beforeEach(() => {
  mockTargetSchema.mockReset();
  mockNavigate.mockReset();
  sourceErrorProps = undefined;
  mockSourceAtPath.mockReset();
  // The pointer, well-formed, unless a case says otherwise.
  mockSourceAtPath.mockImplementation(() => ({
    status: "success",
    data: TARGET,
  }));
});

describe("ViewField", () => {
  test("a row that leads to the module it names", () => {
    mount(employees["executeSerialize"]());
    fireEvent.click(screen.getByRole("button"));
    expect(mockNavigate).toHaveBeenCalledWith(TARGET);
  });

  test("the target being hidden does not hide the row", () => {
    mount(employees.hidden()["executeSerialize"]());
    fireEvent.click(screen.getByRole("button"));
    expect(mockNavigate).toHaveBeenCalledWith(TARGET);
  });

  test("the target being readonly does not disable the row", () => {
    mount(employees.readonly()["executeSerialize"]());
    fireEvent.click(screen.getByRole("button"));
    expect(mockNavigate).toHaveBeenCalledWith(TARGET);
  });

  /**
   * The description is the one thing the row DOES take from the target: it is
   * what the module says it is, and repeating it on every view that points
   * there would be the same sentence written once per page.
   */
  test("the target's description labels the row", () => {
    mount(employees.describe("Everyone who works here")["executeSerialize"]());
    expect(screen.getByText("Everyone who works here")).toBeTruthy();
  });

  test("a target the project does not have is reported, not navigated to", () => {
    mockTargetSchema.mockImplementation(() => ({ status: "not-found" }));
    render(<ViewField path={PATH} schema={viewSchema} />);
    expect(screen.getByTestId("not-found")).toBeTruthy();
  });

  /**
   * The row asks for the target's SCHEMA, by module path, and never for a
   * source path under it.
   *
   * `useSchemaAtPath` resolves a schema against a source path, which needs the
   * module's source — so it peeks and demands it. For a `.jsonValues()` target
   * that is every entry of a record this row does no more than link to. A view
   * is a link; a link must not load what it points at.
   */
  test("the row asks only for the target's schema", () => {
    mount(employees["executeSerialize"]());
    expect(mockTargetSchema).toHaveBeenCalledWith(TARGET);
  });

  /**
   * A malformed pointer offers a Fix, and the Fix is built from the schema this
   * gets handed. The empty value of a VIEW is the pointer, which is the repair;
   * the empty value of the TARGET is an object of the wrong shape entirely,
   * which is what this used to write into the field.
   */
  test("a source error is repaired with the view's own schema", () => {
    mockTargetSchema.mockImplementation(() => ({
      status: "success",
      data: employees["executeSerialize"](),
    }));
    mockSourceAtPath.mockImplementation(() => ({
      status: "error",
      error: "Expected a view pointer",
    }));
    render(<ViewField path={PATH} schema={viewSchema} />);
    expect(sourceErrorProps).toEqual({
      status: "success",
      data: viewSchema,
    });
  });
});

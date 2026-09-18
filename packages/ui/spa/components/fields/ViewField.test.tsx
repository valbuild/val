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
const mockSchemaAt = jest.fn();
const mockNavigate = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useSchemaAtPath: (path: SourcePath) => mockSchemaAt(path),
  useShallowSourceAtPath: () => ({
    status: "success",
    data: "/data/employees.val.ts",
  }),
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
  FieldSourceError: () => <div data-testid="source-error" />,
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
  mockSchemaAt.mockImplementation(() => ({
    status: "success",
    data: targetSchema,
  }));
  return render(<ViewField path={PATH} schema={viewSchema} />);
}

const employees = s.record(s.object({ name: s.string() }));

beforeEach(() => {
  mockSchemaAt.mockReset();
  mockNavigate.mockReset();
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
    mockSchemaAt.mockImplementation(() => ({ status: "not-found" }));
    render(<ViewField path={PATH} schema={viewSchema} />);
    expect(screen.getByTestId("not-found")).toBeTruthy();
  });
});

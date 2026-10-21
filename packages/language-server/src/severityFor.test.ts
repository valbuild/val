import { DiagnosticSeverity } from "vscode-languageserver";
import { severityFor } from "./diagnostics";

describe("severityFor", () => {
  test("a local file in a project with remote files is a warning, as in the CLI", () => {
    expect(
      severityFor({ code: "val/validation", fixes: ["images:upload-remote"] }),
    ).toBe(DiagnosticSeverity.Warning);
  });

  test("a missing file is an error, whatever fix it was reported with", () => {
    expect(
      severityFor({
        code: "val/file-not-found",
        fixes: ["image:upload-remote"],
      }),
    ).toBe(DiagnosticSeverity.Error);
  });

  test("an error with no fixes is an error", () => {
    expect(severityFor({ code: "val/validation" })).toBe(
      DiagnosticSeverity.Error,
    );
  });
});

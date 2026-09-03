import { safeHref } from "./safeHref";

describe("safeHref", () => {
  test("keeps same-origin paths", () => {
    expect(safeHref("/admin/settings")).toBe("/admin/settings");
    expect(safeHref("/admin?tab=ai#keys")).toBe("/admin?tab=ai#keys");
  });

  test("keeps http and https urls", () => {
    expect(safeHref("https://val.build/admin")).toBe("https://val.build/admin");
    expect(safeHref("http://localhost:3000/admin")).toBe(
      "http://localhost:3000/admin",
    );
  });

  test("rejects schemes that would run in the Studio", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    // A capital letter or whitespace does not get it past the parser: `URL`
    // lower-cases the protocol and trims leading control characters, which is
    // exactly why the check reads `parsed.protocol` rather than the raw string.
    expect(safeHref("JavaScript:alert(1)")).toBeUndefined();
    expect(safeHref(" javascript:alert(1)")).toBeUndefined();
    expect(
      safeHref("data:text/html,<script>alert(1)</script>"),
    ).toBeUndefined();
    expect(safeHref("vbscript:msgbox(1)")).toBeUndefined();
  });

  test("rejects protocol-relative urls and unparseable input", () => {
    // `//evil.example` is a different origin wearing a path's clothes.
    expect(safeHref("//evil.example/admin")).toBeUndefined();
    expect(safeHref("admin/settings")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
});

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  VERSION_PLACEHOLDER,
  RECORD_PLACEHOLDER,
  replaceVersionPlaceholder,
  replaceRecordPlaceholder,
  assertNoPlaceholdersLeft,
} = require("./buildPlaceholders");

describe("replaceVersionPlaceholder", () => {
  test("replaces the placeholder as written in the sources", () => {
    const { content, count } = replaceVersionPlaceholder(
      `export const VERSION = "${VERSION_PLACEHOLDER}";`,
      "1.2.3",
    );
    expect(content).toBe(`export const VERSION = "1.2.3";`);
    expect(count).toBe(1);
  });

  test("replaces the placeholder as Vite 8 re-prints it, with every $ escaped", () => {
    // This is verbatim what rolldown/oxc emits for
    // `${VERSION ? `/${VERSION}` : ""}${VAL_APP_PATH}` once it folds the
    // template literal - and what the plain string replace it replaced could
    // not find, which is what shipped a broken 0.108.0.
    const { content, count } = replaceVersionPlaceholder(
      "path === `/\\$\\$BUILD_\\$\\$REPLACE_WITH_VERSION\\$\\$/app`",
      "1.2.3",
    );
    expect(content).toBe("path === `/1.2.3/app`");
    expect(count).toBe(1);
  });

  test("replaces every occurrence, not just the first", () => {
    const { content, count } = replaceVersionPlaceholder(
      "`/\\$\\$BUILD_\\$\\$REPLACE_WITH_VERSION\\$\\$/app` " +
        `"${VERSION_PLACEHOLDER}"`,
      "1.2.3",
    );
    expect(content).toBe('`/1.2.3/app` "1.2.3"');
    expect(count).toBe(2);
  });

  test("leaves content without the placeholder alone", () => {
    const { content, count } = replaceVersionPlaceholder("no marker", "1.2.3");
    expect(content).toBe("no marker");
    expect(count).toBe(0);
  });

  test("does not touch the record placeholder", () => {
    const { content, count } = replaceVersionPlaceholder(
      RECORD_PLACEHOLDER,
      "1.2.3",
    );
    expect(content).toBe(RECORD_PLACEHOLDER);
    expect(count).toBe(0);
  });
});

describe("replaceRecordPlaceholder", () => {
  test("inserts the record verbatim, treating $ in it as data", () => {
    // `$&` and friends are replacement patterns for String.replace: a file
    // record that happened to contain one must not be re-interpreted.
    const record = JSON.stringify({ "/index.html": "YSQmYg==$&" });
    const { content, count } = replaceRecordPlaceholder(
      `JSON.parse(\`${RECORD_PLACEHOLDER}\`)`,
      record,
    );
    expect(content).toBe(`JSON.parse(\`${record}\`)`);
    expect(count).toBe(1);
  });

  test("replaces the placeholder with every $ escaped", () => {
    const { content, count } = replaceRecordPlaceholder(
      "JSON.parse(`\\$\\$BUILD_\\$\\$REPLACE_WITH_RECORD\\$\\$`)",
      "{}",
    );
    expect(content).toBe("JSON.parse(`{}`)");
    expect(count).toBe(1);
  });
});

describe("assertNoPlaceholdersLeft", () => {
  test("passes for fully substituted content", () => {
    expect(() =>
      assertNoPlaceholdersLeft("const VERSION = '1.2.3';", "some-file.js"),
    ).not.toThrow();
  });

  test("throws when a version placeholder survived in any form", () => {
    expect(() =>
      assertNoPlaceholdersLeft(
        "path === `/\\$\\$BUILD_\\$\\$REPLACE_WITH_VERSION\\$\\$/app`",
        "some-file.js",
      ),
    ).toThrow(/REPLACE_WITH_VERSION.*was not replaced in some-file\.js/s);
  });

  test("throws when a record placeholder survived", () => {
    expect(() =>
      assertNoPlaceholdersLeft(RECORD_PLACEHOLDER, "some-file.js"),
    ).toThrow(/REPLACE_WITH_RECORD/);
  });

  test("can be limited to a subset of the markers", () => {
    expect(() =>
      assertNoPlaceholdersLeft(VERSION_PLACEHOLDER, "some-file.js", [
        "REPLACE_WITH_RECORD",
      ]),
    ).not.toThrow();
  });
});

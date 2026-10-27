import { initVal } from "../initVal";
import { SourcePath } from "../val";

const { s } = initVal();

const at = "/content/a.val.ts" as SourcePath;

/**
 * The scope messages a schema raises, and only those.
 *
 * A module validates its content as well as its shape, so filtering is what
 * keeps these tests about the rule rather than about the fixtures around it.
 */
function messagesOf(res: false | Record<SourcePath, { message: string }[]>) {
  if (res === false) {
    return [];
  }
  return Object.values(res)
    .flat()
    .map((each) => each.message)
    .filter(
      (message) =>
        message.includes("one locale field") ||
        message.includes("cannot set another"),
    );
}

describe("the locale scope rule", () => {
  test("one locale field on an object is the ordinary case", () => {
    const schema = s.object({ locale: s.locale(), title: s.string() });
    const res = schema["executeValidate"](at, {
      locale: "nb-NO",
      title: "Vinterjakke",
    });
    expect(messagesOf(res)).toEqual([]);
  });

  test("two locale fields on one object is a schema error", () => {
    // The subtree below would be in two languages at once, which is not a
    // thing content can be.
    const schema = s.object({
      locale: s.locale(),
      language: s.locale(),
      title: s.string(),
    });
    const res = schema["executeValidate"](at, {
      locale: "nb-NO",
      language: "en-US",
      title: "Vinterjakke",
    });
    expect(messagesOf(res)).toEqual([
      "An object can be in one language, so it can have one locale field. Found 'locale', 'language'.",
    ]);
  });

  test("a locale field inside a locale-keyed record is a scope inside a scope", () => {
    const schema = s.record(
      s.locale(),
      s.object({ locale: s.locale(), title: s.string() }),
    );
    const res = schema["executeValidate"](at, {
      "nb-NO": { locale: "nb-NO", title: "Vinterjakke" },
    });
    expect(messagesOf(res)).toEqual([
      "Everything here is already in one language, so its entries cannot set another. " +
        "Move the locale field out of this locale-keyed record, or take the outer one away.",
    ]);
  });

  test("a locale-keyed record inside an object that has a locale field", () => {
    const schema = s.object({
      locale: s.locale(),
      byLanguage: s.record(s.locale(), s.string()),
    });
    const res = schema["executeValidate"](at, {
      locale: "nb-NO",
      byLanguage: { "nb-NO": "x" },
    });
    expect(messagesOf(res)).toEqual([
      "Everything here is already in one language, so 'byLanguage' cannot set another. " +
        "Move the locale-keyed record out of this object, or take the outer one away.",
    ]);
  });

  test("a scope several levels down is still inside the outer one", () => {
    const schema = s.object({
      locale: s.locale(),
      body: s.object({
        sections: s.array(s.object({ locale: s.locale(), text: s.string() })),
      }),
    });
    const res = schema["executeValidate"](at, {
      locale: "nb-NO",
      body: { sections: [{ locale: "en-US", text: "x" }] },
    });
    expect(messagesOf(res)).toEqual([
      "Everything here is already in one language, so 'body.sections[]' cannot set another. " +
        "Move the locale field out of this object, or take the outer one away.",
    ]);
  });

  test("a scope three deep is reported once, by the one enclosing it", () => {
    // Not by every ancestor: the walk stops at the first scope it finds, so
    // the outer object reports the middle one and the middle one reports the
    // inner. Two nestings, two errors, neither repeated.
    const schema = s.object({
      locale: s.locale(),
      inner: s.record(
        s.locale(),
        s.object({ locale: s.locale(), text: s.string() }),
      ),
    });
    const res = schema["executeValidate"](at, {
      locale: "nb-NO",
      inner: { "nb-NO": { locale: "nb-NO", text: "x" } },
    });
    const messages = messagesOf(res);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("'inner' cannot set another");
    expect(messages[1]).toContain("its entries cannot set another");
  });

  test("sibling scopes are fine: neither contains the other", () => {
    const schema = s.object({
      no: s.object({ locale: s.locale(), title: s.string() }),
      en: s.object({ locale: s.locale(), title: s.string() }),
    });
    const res = schema["executeValidate"](at, {
      no: { locale: "nb-NO", title: "Vinterjakke" },
      en: { locale: "en-US", title: "Winter jacket" },
    });
    expect(messagesOf(res)).toEqual([]);
  });

  test("an array of scoped objects is many scopes, not a nested one", () => {
    const schema = s.array(s.object({ locale: s.locale(), title: s.string() }));
    const res = schema["executeValidate"](at, [
      { locale: "nb-NO", title: "Vinterjakke" },
      { locale: "en-US", title: "Winter jacket" },
    ]);
    expect(messagesOf(res)).toEqual([]);
  });

  test("a module with no locales anywhere raises nothing", () => {
    const schema = s.object({
      title: s.string(),
      nested: s.record(s.string(), s.object({ n: s.number() })),
    });
    const res = schema["executeValidate"](at, {
      title: "x",
      nested: { a: { n: 1 } },
    });
    expect(messagesOf(res)).toEqual([]);
  });
});

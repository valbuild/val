import { initSchema } from "./initSchema";
import { content } from "./module";
import { i18n as initI18n, remote } from "./Source";
import { valuation } from "./valuation";

describe("valuation", () => {
  test("todo", () => {
    const s = initSchema(["en_US"]);
    const i18n = initI18n(["en_US"]);
    const schema = s.object({
      localized: s.i18n(s.string()),
      unionized: s.union(
        "type",
        s.object({ type: s.string<"foo">() }),
        s.object({ type: s.string<"bar">() })
      ),
      remotized: s.array(s.number()).remote(),
    });
    const testVal = content("/app", schema, {
      localized: i18n({ en_US: "foo" as string }),
      remotized: remote("123"),
      unionized: { type: "foo" },
    });
    const { test } = valuation({ test: testVal });
    test;
    //^?
  });
});

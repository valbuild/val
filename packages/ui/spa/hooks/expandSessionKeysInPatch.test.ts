import {
  FILE_REF_SUBTYPE_TAG,
  Internal,
  VAL_EXTENSION,
  initVal,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";
import { Patch } from "@valbuild/shared/internal";
import {
  isSessionKey,
  planSessionKeyExpansion,
  type SessionKey,
} from "./expandSessionKeysInPatch";

const { s, c } = initVal();

function serialize(valModule: ReturnType<typeof c.define>) {
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
  if (!schema) throw new Error("Schema not found");
  const source = Internal.getSource(valModule);
  return { schema: schema as SerializedSchema, source: source as Source };
}

describe("planSessionKeyExpansion", () => {
  test("smoke: image leaf — replace value with SessionKey produces one transfer and a rewritten patch", () => {
    const { schema, source } = serialize(
      c.define("/content/page.val.ts", s.object({ hero: s.image() }), {
        hero: null as unknown as never,
      }),
    );
    const sessionKey: SessionKey = {
      key: "session-key-abc",
      filePath: "/public/val/images/hero.png",
      [VAL_EXTENSION]: "ai_session_file",
      [FILE_REF_SUBTYPE_TAG]: "image",
      alt: "the hero",
    };
    expect(isSessionKey(sessionKey)).toBe(true);

    const inputPatch = Patch.parse([
      { op: "replace", path: ["hero"], value: sessionKey },
    ]);

    const plan = planSessionKeyExpansion({
      patch: inputPatch,
      moduleSchema: schema,
      moduleSource: source,
    });
    if (plan.kind !== "ok") {
      throw new Error(`Expected ok plan, got ${plan.kind}`);
    }
    expect(plan.transfers).toEqual([
      {
        siteId: 0,
        key: "session-key-abc",
        filePath: "/public/val/images/hero.png",
      },
    ]);

    const applied = plan.apply({
      0: { width: 800, height: 600, mimeType: "image/png" },
    });
    if (applied.kind !== "ok") {
      throw new Error(`Expected ok apply, got ${applied.kind}`);
    }
    expect(applied.patch).toEqual([
      {
        op: "replace",
        path: ["hero"],
        value: {
          _ref: "/public/val/images/hero.png",
          _type: "file",
          _tag: "image",
          metadata: {
            width: 800,
            height: 600,
            mimeType: "image/png",
            alt: "the hero",
          },
        },
      },
      {
        op: "file",
        path: ["hero"],
        filePath: "/public/val/images/hero.png",
        value: "session-key-abc",
        remote: false,
        metadata: {
          width: 800,
          height: 600,
          mimeType: "image/png",
          alt: "the hero",
        },
      },
    ]);
  });

  test("smoke: richtext inline img — add op with {tag:'img', src:SessionKey} produces one transfer + nestedFilePath", () => {
    const { schema, source } = serialize(
      c.define(
        "/content/article.val.ts",
        s.object({
          body: s.richtext({
            inline: { img: true },
          }),
        }),
        { body: [] },
      ),
    );
    const sessionKey: SessionKey = {
      key: "session-key-rt",
      filePath: "/public/val/images/inline.png",
      [VAL_EXTENSION]: "ai_session_file",
      [FILE_REF_SUBTYPE_TAG]: "image",
    };
    const inputPatch = Patch.parse([
      {
        op: "add",
        path: ["body", "0", "children", "1"],
        value: { tag: "img", src: sessionKey },
      },
    ]);

    const plan = planSessionKeyExpansion({
      patch: inputPatch,
      moduleSchema: schema,
      moduleSource: source,
    });
    if (plan.kind !== "ok") {
      throw new Error(`Expected ok plan, got ${plan.kind}`);
    }
    expect(plan.transfers).toEqual([
      {
        siteId: 0,
        key: "session-key-rt",
        filePath: "/public/val/images/inline.png",
      },
    ]);

    const applied = plan.apply({
      0: { width: 400, height: 300, mimeType: "image/png" },
    });
    if (applied.kind !== "ok") {
      throw new Error(`Expected ok apply, got ${applied.kind}`);
    }
    expect(applied.patch).toEqual([
      {
        op: "add",
        path: ["body", "0", "children", "1"],
        value: {
          tag: "img",
          src: {
            _ref: "/public/val/images/inline.png",
            _type: "file",
            _tag: "image",
            metadata: { width: 400, height: 300, mimeType: "image/png" },
          },
        },
      },
      {
        op: "file",
        path: ["body", "0", "children", "1"],
        nestedFilePath: ["src"],
        filePath: "/public/val/images/inline.png",
        value: "session-key-rt",
        remote: false,
        metadata: { width: 400, height: 300, mimeType: "image/png" },
      },
    ]);
  });
});

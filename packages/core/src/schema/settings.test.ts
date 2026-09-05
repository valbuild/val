import { initVal } from "../initVal";
import {
  assistantAvailability,
  ASSISTANT_SETTINGS_MAX_LENGTH,
} from "../source/settings";
import { ModuleFilePath, SourcePath } from "../val";
import { deserializeSchema } from "./deserialize";
import { resolveSettingsModule } from "../settingsModule";
import { settings } from "./settings";

const { s, c } = initVal();

describe("SettingsSchema", () => {
  test("an empty settings module is valid", () => {
    // The case the whole schema exists for: `{}` is a complete settings module,
    // and stays one as sections are added.
    expect(settings()["executeValidate"]("path" as SourcePath, {})).toEqual(
      false,
    );
  });

  test("assert: an empty object passes", () => {
    expect(settings()["executeAssert"]("path" as SourcePath, {})).toEqual({
      success: true,
      data: {},
    });
  });

  test("assert: does NOT require its keys, unlike an object schema", () => {
    // s.object({ ai: ... }) errors with "Expected key 'ai' not found in object"
    // here. That difference is the reason settings is not sugar over s.object().
    const objectSchema = s.object({ ai: s.string() });
    const objectAssert = objectSchema["executeAssert"](
      "path" as SourcePath,
      {},
    );
    expect(objectAssert.success).toBe(false);
    expect(settings()["executeAssert"]("path" as SourcePath, {}).success).toBe(
      true,
    );
  });

  test("assert: a non-object fails", () => {
    expect(
      settings()["executeAssert"]("path" as SourcePath, "not an object")
        .success,
    ).toBe(false);
    expect(settings()["executeAssert"]("path" as SourcePath, []).success).toBe(
      false,
    );
  });

  test("a partially filled section is valid", () => {
    // Neither the section nor the fields in it have to be complete: `tone` is
    // absent, not missing.
    expect(
      settings()["executeValidate"]("path" as SourcePath, {
        assistant: { context: "A CMS for developers." },
      }),
    ).toEqual(false);
  });

  test("null means unset, the same as absent", () => {
    expect(
      settings()["executeValidate"]("path" as SourcePath, {
        assistant: { context: null, tone: null },
      }),
    ).toEqual(false);
  });

  test("validates the fields inside a section that IS set", () => {
    const res = settings()["executeValidate"]("path" as SourcePath, {
      assistant: { tone: "x".repeat(ASSISTANT_SETTINGS_MAX_LENGTH + 1) },
    });
    expect(res).not.toEqual(false);
    expect(Object.keys(res || {})).toEqual(['path?p="assistant"."tone"']);
  });

  test("an unknown key is an error, so a typo does not go unnoticed", () => {
    // Through the deserialized schema, which is what the Studio's validation
    // worker runs — and the only place a typo can still arrive, since
    // `SettingsSource` rejects `toneOfVoice` at author time.
    const schema = deserializeSchema(settings()["executeSerialize"]());
    const res = schema["executeValidate"]("path" as SourcePath, {
      // The name we did not pick: reported rather than silently ignored.
      toneOfVoice: "Formal",
    });
    expect(res).not.toEqual(false);
    expect(res && res["path" as SourcePath][0].message).toContain(
      "Unknown settings key: 'toneOfVoice'",
    );
  });

  test("serializes with its sections, and round-trips through deserialize", () => {
    const serialized = settings()["executeSerialize"]();
    expect(serialized.type).toBe("settings");
    expect(serialized).toMatchObject({
      type: "settings",
      items: {
        assistant: {
          type: "settings",
          items: {
            context: { type: "string", multiline: true },
            tone: { type: "string", multiline: true },
          },
        },
      },
    });
    const deserialized = deserializeSchema(serialized);
    // The deserialized schema is what the Studio's validation worker runs, so it
    // has to keep the optional-key semantics.
    expect(deserialized["executeValidate"]("path" as SourcePath, {})).toEqual(
      false,
    );
    expect(deserialized["executeSerialize"]()).toEqual(serialized);
  });

  test("a settings module can be defined with an empty source", () => {
    const settingsVal = c.define("/settings.val.ts", s.settings(), {});
    expect(settingsVal).toBeDefined();
  });

  test("a settings module can be defined with ai context and tone", () => {
    const settingsVal = c.define("/settings.val.ts", s.settings(), {
      assistant: {
        context: "A CMS for developers.",
        tone: "Plain and direct.",
      },
    });
    expect(settingsVal).toBeDefined();
  });
});

describe("assistantAvailability", () => {
  test("a project with no settings module has one", () => {
    // Nowhere to record a decision, so there is nothing to prompt for — and
    // nothing to prompt INTO, since the prompt writes to a settings module.
    expect(assistantAvailability(undefined)).toBe("on");
  });

  test("a settings module that has not decided is offered, not assumed", () => {
    // The distinction the tri-state exists for. Hiding it means nobody
    // discovers the assistant; assuming it means a project starts sending its
    // content to a model because it did not know to say no.
    expect(assistantAvailability({})).toBe("unconfigured");
    expect(assistantAvailability({ assistant: {} })).toBe("unconfigured");
    expect(assistantAvailability({ assistant: { enabled: null } })).toBe(
      "unconfigured",
    );
  });

  test("said either way, it is that", () => {
    expect(assistantAvailability({ assistant: { enabled: true } })).toBe("on");
    expect(assistantAvailability({ assistant: { enabled: false } })).toBe(
      "off",
    );
  });
});

describe("resolveSettingsModule", () => {
  const settingsSchema = settings()["executeSerialize"]();
  const pageSchema = s.object({ title: s.string() })["executeSerialize"]();

  test("finds the settings module at the root", () => {
    expect(
      resolveSettingsModule({
        ["/content/page.val.ts" as ModuleFilePath]: pageSchema,
        ["/settings.val.ts" as ModuleFilePath]: settingsSchema,
      }),
    ).toEqual({ moduleFilePath: "/settings.val.ts", errors: [] });
  });

  test("any root module may hold it, not just settings.val.ts", () => {
    expect(
      resolveSettingsModule({
        ["/config.val.ts" as ModuleFilePath]: settingsSchema,
      }),
    ).toEqual({ moduleFilePath: "/config.val.ts", errors: [] });
  });

  test("no settings module is not an error", () => {
    expect(
      resolveSettingsModule({
        ["/content/page.val.ts" as ModuleFilePath]: pageSchema,
      }),
    ).toEqual({ moduleFilePath: null, errors: [] });
  });

  test("settings in a subdirectory is an error, and is not used", () => {
    const res = resolveSettingsModule({
      ["/content/settings.val.ts" as ModuleFilePath]: settingsSchema,
    });
    expect(res.moduleFilePath).toBe(null);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].path).toBe("/content/settings.val.ts");
    expect(res.errors[0].message).toContain("root");
  });

  test("two settings modules is an error, and neither wins", () => {
    // Deliberately not resolved by sort order: picking one means the answer
    // changes when a file is renamed.
    const res = resolveSettingsModule({
      ["/settings.val.ts" as ModuleFilePath]: settingsSchema,
      ["/config.val.ts" as ModuleFilePath]: settingsSchema,
    });
    expect(res.moduleFilePath).toBe(null);
    // One per offending module, so the message is there whichever file you open.
    expect(res.errors.map((error) => error.path)).toEqual([
      "/config.val.ts",
      "/settings.val.ts",
    ]);
    for (const error of res.errors) {
      expect(error.message).toContain(
        "'/config.val.ts' and '/settings.val.ts'",
      );
    }
  });
});

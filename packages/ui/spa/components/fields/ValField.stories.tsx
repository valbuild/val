import { Schema, SerializedSchema, Source, SourcePath } from "@valbuild/core";
import { AnyVal } from "./ValCompositeFields";
import { ValUIContext } from "../ValUIContext";
import { Meta, StoryObj } from "@storybook/react";
import { Internal } from "@valbuild/core";
import { InitOnSubmit } from "./ValFormField";

const meta: Meta<typeof AnyVal> = {
  component: AnyVal,
  title: "Fields",
  render: (args) => (
    <ValUIContext.Provider
      value={{
        theme: "light",
        setTheme: () => {},
        editMode: "full",
        setEditMode: () => {},
        session: {
          status: "success",
          data: { enabled: true, mode: "local" },
        },
        setWindowSize: () => {},
      }}
    >
      <div className="p-4 bg-background">
        <AnyVal {...args} />
      </div>
    </ValUIContext.Provider>
  ),
};
export default meta;
type Story = StoryObj<typeof AnyVal>;

const DefaultArgs = {
  initOnSubmit: ((path) => async (patchCallBack) => {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    console.log(
      moduleFilePath,
      await patchCallBack(Internal.createPatchPath(modulePath)),
    );
  }) satisfies InitOnSubmit,
};

function create<S extends Source>(
  schema: Schema<S>,
  source: S,
): {
  schema: SerializedSchema;
  source: S;
} {
  return {
    schema: schema.serialize(),
    source,
  };
}
const s = Internal.initSchema();

export const BasicStringField: Story = {
  args: {
    ...DefaultArgs,
    path: "/basic/string" as SourcePath,
    ...create(s.string(), "Hello World"),
  },
};

export const OptionalStringField: Story = {
  args: {
    ...DefaultArgs,
    path: "/optional/string" as SourcePath,
    ...create(s.string().nullable(), "Hello World"),
  },
};

export const EmptyOptionalStringField: Story = {
  args: {
    ...DefaultArgs,
    path: "/empty/string" as SourcePath,
    ...create(s.string().nullable(), null),
  },
};

export const BasicRichTextField: Story = {
  args: {
    ...DefaultArgs,
    path: "/basic/richText" as SourcePath,
    ...create(s.richtext({ block: { h1: true } }), [
      { tag: "h1", children: ["Title 1"] },
    ]),
  },
};

export const BasicObject: Story = {
  args: {
    ...DefaultArgs,
    path: "/basic/object" as SourcePath,
    ...create(s.object({ one: s.string(), two: s.string() }), {
      one: "Test 1",
      two: "Test 2",
    }),
  },
};

export const BasicOptionalObject: Story = {
  args: {
    ...DefaultArgs,
    path: "/basic/optional/object" as SourcePath,
    top: true,
    ...create(s.object({ one: s.string().nullable(), two: s.string() }), {
      one: "Test 1",
      two: "Test 2",
    }),
  },
};

export const BasicEmptyObject: Story = {
  args: {
    ...DefaultArgs,
    path: "/basic/empty/object" as SourcePath,
    top: true,
    ...create(
      s.object({ one: s.string().nullable(), two: s.string() }).nullable(),
      null,
    ),
  },
};

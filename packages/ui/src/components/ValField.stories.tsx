import {
  AnyRichTextOptions,
  RichText,
  RichTextSource,
  SerializedRichTextSchema,
  SerializedStringSchema,
  SourcePath,
} from "@valbuild/core";
import { AnyVal } from "./ValCompositeFields";
import { ValUIContext } from "./ValUIContext";
import { Meta, StoryObj } from "@storybook/react";

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
      <AnyVal {...args} />
    </ValUIContext.Provider>
  ),
};
export default meta;
type Story = StoryObj<typeof AnyVal>;

const DefaultArgs = {
  initOnSubmit: () => async () => {},
};

export const BasicStringField: Story = {
  args: {
    ...DefaultArgs,
    path: "/test/string" as SourcePath,
    schema: {
      type: "string",
      raw: false,
      opt: false,
    } satisfies SerializedStringSchema,
    source: "Test" satisfies string,
  },
};

export const EmptyStringField: Story = {
  args: {
    ...DefaultArgs,
    path: "/test/string" as SourcePath,
    field: "fieldname",
    schema: {
      type: "string",
      raw: false,
      opt: true,
    } satisfies SerializedStringSchema,
    source: null,
  },
};

export const BasicRichTextField: Story = {
  args: {
    ...DefaultArgs,
    path: "/test/richText" as SourcePath,
    schema: {
      type: "richtext",
      opt: false,
    } satisfies SerializedRichTextSchema,
    source: {
      _type: "richtext",
      exprs: [],
      templateStrings: ["# Title 1"],
    } satisfies RichTextSource<AnyRichTextOptions>,
  },
};

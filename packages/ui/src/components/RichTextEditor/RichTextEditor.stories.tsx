import { ValUIContext } from "../ValUIContext";
import { RichTextEditor, RichTextEditorProps } from "./RichTextEditor";
import { Meta, StoryFn } from "@storybook/react";

export default {
  title: "RichTextEditor",
  component: RichTextEditor,
} as Meta;

const Template: StoryFn<RichTextEditorProps> = (args) => (
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
    <RichTextEditor {...args} />
  </ValUIContext.Provider>
);

export const DropdownStory = Template.bind({});

DropdownStory.args = {
  richtext: {
    _type: "richtext",
    templateStrings: ["# Title 1"],
    exprs: [],
  },
};

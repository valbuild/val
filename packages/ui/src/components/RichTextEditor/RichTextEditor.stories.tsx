import { ValApi } from "@valbuild/core";
import { ValOverlayContext } from "../ValOverlayContext";
import { RichTextEditor, RichTextEditorProps } from "./RichTextEditor";
import { Meta, Story } from "@storybook/react";

export default {
  title: "RichTextEditor",
  component: RichTextEditor,
} as Meta;

const Template: Story<RichTextEditorProps> = (args) => (
  <ValOverlayContext.Provider
    value={{
      api: new ValApi("http://localhost:3000"),
      theme: "light",
      setTheme: () => {},
      editMode: "full",
      setEditMode: () => {},
      session: {
        status: "success",
        data: { enabled: true, mode: "local" },
      },
      highlight: false,
      setHighlight: () => {},
      setWindowSize: () => {},
    }}
  >
    <RichTextEditor {...args} />
  </ValOverlayContext.Provider>
);

export const DropdownStory = Template.bind({});

DropdownStory.args = {
  richtext: {
    _type: "richtext",
    templateStrings: ["# Title 1"],
    exprs: [],
  },
};

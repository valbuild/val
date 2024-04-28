import type { Meta, StoryObj } from "@storybook/react";

import { SortableList } from "./SortableList";
import {
  Schema,
  SerializedArraySchema,
  SourcePath,
  initVal,
} from "@valbuild/core";

const meta: Meta<typeof SortableList> = { component: SortableList };

export default meta;
type Story = StoryObj<typeof SortableList>;

const { s, c } = initVal();

const schema = s.array(
  s.object({
    name: s.string(),
    fields: s.array(s.string()),
    richtext: s.richtext().nullable(),
  })
);
type SourceOfSchema<S> = S extends Schema<infer Src> ? Src : S;
const source: SourceOfSchema<typeof schema> = [
  {
    name: "Item 1",
    fields: ["Field 1", "Field 2", "Field 3"],
    richtext: null,
  },
  {
    name: "Item 2",
    fields: [],
    richtext: null,
  },
  {
    name: "Item 3",
    fields: ["Field 1"],
    richtext: c.richtext`# Hello world

    ${c.rt.image("/public/test.png")}
    `,
  },
];
export const Default: Story = {
  render: (args) => (
    <div className="max-w-[800px]">
      <SortableList {...args} />
    </div>
  ),
  args: {
    source,
    path: "/content/items" as SourcePath,
    schema: schema.serialize() as SerializedArraySchema,
  },
};

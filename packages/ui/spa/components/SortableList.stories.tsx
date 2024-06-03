import type { Meta, StoryObj } from "@storybook/react";

import { SortableList } from "./SortableList";
import {
  Schema,
  SelectorSource,
  SerializedArraySchema,
  SourcePath,
  initVal,
} from "@valbuild/core";

const meta: Meta<typeof SortableList> = { component: SortableList };

export default meta;
type Story = StoryObj<typeof SortableList>;

const { s, c } = initVal();

type SourceOfSchema<S> = S extends Schema<infer Src> ? Src : S;
function getArgs<S extends Schema<Array<SelectorSource>>>(
  schema: S,
  source: SourceOfSchema<S>
) {
  return {
    path: "/fake" as SourcePath,
    source,
    schema: schema.serialize() as SerializedArraySchema,
  };
}
export const Default: Story = {
  render: (args) => (
    <div className="max-w-[800px]">
      <SortableList {...args} />
    </div>
  ),
  args: getArgs(
    s.array(
      s.object({
        name: s.string(),
        fields: s.array(s.string()),
        record: s.record(s.string()),
        richtext: s.richtext().nullable(),
        unionStrings: s.union(s.literal("test"), s.literal("test2")),
        unionObjects: s
          .union(
            "type",
            s.object({ type: s.literal("type1"), name: s.string() })
          )
          .nullable(),
      })
    ),
    [
      {
        name: "Item 1",
        fields: ["Field 1", "Field 2", "Field 3"],
        record: {
          "Field 1": "Value 1",
          "Field 2": "Value 2",
          "Field 3": "Value 3",
        },
        richtext: null,
        unionStrings: "test",
        unionObjects: null,
      },
      {
        name: "Item 2",
        fields: [],
        record: {},
        richtext: null,
        unionStrings: "test",
        unionObjects: {
          type: "type1",
          name: "Test",
        },
      },
      {
        fields: ["Field 1"],
        name: "Item 3",
        record: {
          "Field 1": "Value 1",
        },
        richtext: c.richtext`# Hello world
      
Test 1 2 3
${c.rt.image("/public/test.png")}
    `,
        unionStrings: "test",
        unionObjects: null,
      },
    ]
  ),
};

export const Strings: Story = {
  render: (args) => (
    <div className="max-w-[800px]">
      <SortableList {...args} onClick={() => {}} onMove={async () => {}} />
    </div>
  ),
  args: getArgs(s.array(s.string()), ["Item 1", "Item 2", "Item 3"]),
};

import type { Meta, StoryObj } from "@storybook/react";
import { Tree } from "./Tree";

const meta: Meta<typeof Tree> = { component: Tree };

export default meta;
type Story = StoryObj<typeof Tree>;

type Node = {
  path: string;
  type: "text" | "image" | "section";
  children: Node[];
};

const nodes: Node[] = [
  {
    path: "Main nav",
    type: "section",
    children: [],
  },
  {
    path: "H1",
    type: "text",
    children: [
      {
        path: "Section 3",
        type: "text",
        children: [],
      },
      {
        path: "Section 4",
        type: "section",
        children: [
          {
            path: "Section 5",
            type: "text",
            children: [],
          },
          {
            path: "Section 6",
            type: "section",
            children: [
              {
                path: "Section 7",
                type: "text",
                children: [],
              },
              {
                path: "Image 1",
                type: "image",
                children: [],
              },
              {
                path: "Image 2",
                type: "image",
                children: [],
              },
            ],
          },
        ],
      },
    ],
  },
];

const renderNodes = (node: Node) => (
  <Tree.Node path={node.path} type={node.type}>
    {node.children.map(renderNodes)}
  </Tree.Node>
);

export const Default: Story = {
  render: () => (
    <Tree rootPath="root">
      <Tree.Node path="Main nav" type="section" />
      <Tree.Node path="H1" type="text">
        <Tree.Node path="Section 3" type="text" />
        <Tree.Node path="Section 4" type="section">
          <Tree.Node path="Section 5" type="text" />
          <Tree.Node path="Section 6" type="section">
            <Tree.Node path="Section 7" type="text" />
          </Tree.Node>
        </Tree.Node>
      </Tree.Node>
    </Tree>
  ),
};

export const TestData: Story = {
  render: () => <Tree rootPath="root">{nodes.map(renderNodes)}</Tree>,
};



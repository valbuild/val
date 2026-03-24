import type { Meta, StoryObj } from "@storybook/react";
import { ModuleFilePath } from "@valbuild/core";
import { FieldPatchAuthorsPure } from "./FieldPatchAuthors";
import { PendingPatch, Profile } from "./ValProvider";

const now = new Date("2025-03-24T12:00:00Z");

const basePatches = (authorId: string): PendingPatch[] => [
  {
    moduleFilePath: "/content/articles.val.ts" as ModuleFilePath,
    patch: [{ op: "replace", path: ["title"], value: "Hello" }],
    isPending: true,
    createdAt: "2025-03-24T11:45:00Z",
    authorId,
    isCommitted: undefined,
  },
  {
    moduleFilePath: "/content/articles.val.ts" as ModuleFilePath,
    patch: [{ op: "add", path: ["tags", "-"], value: "news" }],
    isPending: true,
    createdAt: "2025-03-24T11:30:00Z",
    authorId,
    isCommitted: undefined,
  },
];

const alice: Profile = { fullName: "Alice Andersen", avatar: null };
const bob: Profile = {
  fullName: "Bob Berntsen",
  avatar: { url: "https://i.pravatar.cc/48?u=bob" },
};
const carol: Profile = { fullName: "Carol Christensen", avatar: null };
const dave: Profile = { fullName: "Dave Dahl", avatar: null };
const eve: Profile = { fullName: "Eve Eriksen", avatar: null };

const meta: Meta<typeof FieldPatchAuthorsPure> = {
  title: "Components/FieldPatchAuthors",
  component: FieldPatchAuthorsPure,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="p-8 bg-bg-primary flex items-center justify-end min-h-[80px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof FieldPatchAuthorsPure>;

export const SingleAuthor: Story = {
  render: () => (
    <FieldPatchAuthorsPure
      patchesByAuthorIds={{ alice: basePatches("alice") }}
      profilesByAuthorIds={{ alice }}
      now={now}
      portalContainer={null}
    />
  ),
};

export const SingleAuthorWithAvatar: Story = {
  render: () => (
    <FieldPatchAuthorsPure
      patchesByAuthorIds={{ bob: basePatches("bob") }}
      profilesByAuthorIds={{ bob }}
      now={now}
      portalContainer={null}
    />
  ),
};

export const MultipleAuthors: Story = {
  render: () => (
    <FieldPatchAuthorsPure
      patchesByAuthorIds={{
        alice: basePatches("alice"),
        bob: basePatches("bob"),
        carol: basePatches("carol"),
      }}
      profilesByAuthorIds={{ alice, bob, carol }}
      now={now}
      portalContainer={null}
    />
  ),
};

export const ManyAuthors: Story = {
  name: "Many Authors (overflow badge)",
  render: () => (
    <FieldPatchAuthorsPure
      patchesByAuthorIds={{
        alice: basePatches("alice"),
        bob: basePatches("bob"),
        carol: basePatches("carol"),
        dave: basePatches("dave"),
        eve: basePatches("eve"),
      }}
      profilesByAuthorIds={{ alice, bob, carol, dave, eve }}
      now={now}
      portalContainer={null}
    />
  ),
};

export const UnknownAuthor: Story = {
  name: "Unknown Author (fallback icon)",
  render: () => (
    <FieldPatchAuthorsPure
      patchesByAuthorIds={{ unknown42: basePatches("unknown42") }}
      profilesByAuthorIds={{}}
      now={now}
      portalContainer={null}
    />
  ),
};

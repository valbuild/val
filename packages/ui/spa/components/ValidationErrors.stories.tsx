import type { Meta, StoryObj } from "@storybook/react";
import { SourcePath, ValidationError } from "@valbuild/core";
import { ValidationErrors } from "./ValidationErrors";

const meta: Meta<typeof ValidationErrors> = {
  title: "Components/ValidationErrors",
  component: ValidationErrors,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="p-8 bg-bg-tertiary min-h-screen">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ValidationErrors>;

const samplePath = "/app/pages.val.ts?p=\"/home\".\"title\"" as SourcePath;
const samplePathBody =
  "/app/pages.val.ts?p=\"/home\".\"body\"" as SourcePath;
const samplePathAbout =
  "/app/pages.val.ts?p=\"/about\".\"title\"" as SourcePath;

const sampleErrors: Record<SourcePath, ValidationError[] | undefined> = {
  [samplePath]: [{ message: "Title is required." }],
  [samplePathBody]: [
    { message: "Body must contain at least one paragraph." },
    { message: "Body length exceeds 5000 characters." },
  ],
  [samplePathAbout]: [{ message: "Title must be at most 60 characters." }],
};

export const Empty: Story = {
  args: {
    errorFields: [],
    allErrors: {},
  },
};

export const SingleError: Story = {
  args: {
    errorFields: [samplePath],
    allErrors: sampleErrors,
  },
};

export const MultipleErrors: Story = {
  args: {
    errorFields: [samplePath, samplePathBody, samplePathAbout],
    allErrors: sampleErrors,
  },
};

export const SelectedButNoErrorInStore: Story = {
  args: {
    errorFields: [samplePath],
    allErrors: {},
  },
};

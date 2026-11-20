import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import {
  GlobalSearch,
  collectSearchResults,
  type SearchResult,
} from "../GlobalSearch";
import { mockShellData } from "../mockShellData";

/**
 * The global search (⌘K) while the content it searches is still loading.
 *
 * A search has to see every `.jsonValues()` entry, and a record of 10,000
 * of them loads in batches that take a while. That is allowed as long as it
 * says how far it has got and blocks nothing: results show as they are found,
 * and the rest of the Studio can be used meanwhile.
 */
const meta: Meta<typeof GlobalSearch> = {
  title: "Shell/GlobalSearch",
  component: GlobalSearch,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="relative h-[640px] bg-bg-primary text-fg-primary">
        <Story />
      </div>
    ),
  ],
  args: {
    results: collectSearchResults(mockShellData),
    initialQuery: "post",
    onSelect: fn(),
    onClose: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof GlobalSearch>;

const found: SearchResult[] = [
  {
    id: '/content/posts.val.ts?p="/posts/post-0042"."title"',
    kind: "content",
    label: "Post number 42",
    detail: "/content/posts.val.ts",
  },
  {
    id: '/content/posts.val.ts?p="/posts/post-0420"."title"',
    kind: "content",
    label: "Post number 420",
    detail: "/content/posts.val.ts",
  },
];

/** Loading the content: a bar with the counts, and the hits found so far. */
export const LoadingContent: Story = {
  args: {
    contentResults: found,
    isSearchingContent: true,
    contentLoad: {
      status: "loading",
      loaded: 2_300,
      total: 10_000,
      percentage: 23,
    },
  },
};

/** Just started: nothing found yet, and the count says the wait is real. */
export const LoadingContentNothingYet: Story = {
  args: {
    initialQuery: "number 9999",
    contentResults: [],
    isSearchingContent: true,
    contentLoad: {
      status: "loading",
      loaded: 75,
      total: 10_000,
      percentage: 0,
    },
  },
};

/** A batch failed: what was found is shown, with Try again for the rest. */
export const ContentFailed: Story = {
  args: {
    contentResults: found,
    contentLoad: {
      status: "error",
      message:
        "Could not load 37 entries. First failure — /posts/post-0512 in /content/posts.val.ts: GET /json failed with status 502",
      retry: fn(),
    },
  },
};

/** Everything loaded: no bar. */
export const ContentLoaded: Story = {
  args: {
    contentResults: found,
    contentLoad: { status: "success" },
  },
};

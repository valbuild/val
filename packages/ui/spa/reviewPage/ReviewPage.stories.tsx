import type { Meta, StoryObj } from "@storybook/react";
import type { DiffLayout } from "../diff/types";
import {
  codeOnlyModel,
  emptyModel,
  MockPage,
  proposalModel,
  siteModel,
} from "./fixtures";
import { ReviewPage } from "./ReviewPage";
import { REVIEW_CODE_ID, reviewPageId, type ReviewPageModel } from "./types";

/**
 * Review as a page, on fixtures: no store, no patches, no proposal.
 *
 * The layout under discussion. Every control works inside the story: the nav,
 * the layout switch, Fields and Page, the code changes, and "Any page".
 * "Changes and revert" and "History" lead to the Changes page, which is its
 * own set of stories (`Review (proposed)/Changes and revert`).
 */
function Harness({
  model,
  layout = "inline",
  selected,
  view,
  publishLabel = "Publish",
  pages = true,
}: {
  model: ReviewPageModel;
  layout?: DiffLayout;
  selected?: string;
  view?: "fields" | "page";
  publishLabel?: string;
  /** Whether pages can be drawn: a proposal knows the site's address. */
  pages?: boolean;
}) {
  return (
    <div className="h-screen w-full">
      <ReviewPage
        model={model}
        initialLayout={layout}
        initialSelected={selected}
        initialView={view}
        publish={{ label: publishLabel, onPublish: () => undefined }}
        onOpenChanges={() => undefined}
        onOpenSession={() => undefined}
        renderPage={pages ? (page) => <MockPage {...page} /> : undefined}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Review (proposed)/Review page",
  component: Harness,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Harness>;

/** A proposal with content and code, changes marked in place. */
export const Inline: Story = {
  args: { model: proposalModel, layout: "inline" },
};

/** The same proposal with the two sides in columns. */
export const SideBySide: Story = {
  args: { model: proposalModel, layout: "split" },
};

/** The code changes, under the chat with the assistant that made them. */
export const CodeChanges: Story = {
  args: { model: proposalModel, selected: REVIEW_CODE_ID },
};

/** A changed page looked at as a page: the site beside the proposal. */
export const PageBeforeAndAfter: Story = {
  args: { model: proposalModel, selected: "node:/blogs/hello", view: "page" },
};

/**
 * A page whose content did not change, opened because a changed component is
 * used on it. The same view "Any page" opens for a route typed by hand.
 */
export const PageThatCodeMayAffect: Story = {
  args: { model: proposalModel, selected: reviewPageId("/contact") },
};

/** A page that is new in the proposal. */
export const AddedPage: Story = {
  args: { model: proposalModel, selected: "node:/pricing" },
};

/**
 * A proposal that changes only code. There used to be nothing to review here;
 * now it opens on the code, and lists the pages it may affect.
 */
export const CodeOnly: Story = {
  args: { model: codeOnlyModel },
};

/** The site of a project: pending changes against what is published. */
export const OnTheSite: Story = {
  args: { model: siteModel, pages: false },
};

/** The site, side by side. */
export const OnTheSiteSideBySide: Story = {
  args: { model: siteModel, layout: "split", pages: false },
};

/** Nothing pending. */
export const Empty: Story = {
  args: { model: emptyModel, pages: false },
};

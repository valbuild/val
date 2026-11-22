import type { Meta, StoryObj } from "@storybook/react";
import { ChecksBarView, type ChecksBarViewProps } from "./ChecksBar";

/**
 * The checks that run beside the assistant in code mode, above the composer
 * (`ChecksBar`). The person is never waiting on them: the bar says they run,
 * what they found, and -- when the assistant's automatic fixes stop -- what
 * is still wrong, with "Fix it" to have it fixed.
 */
const meta: Meta<typeof ChecksBarView> = {
  title: "Components/AIChat/Checks",
  component: ChecksBarView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[420px] bg-bg-primary p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    typecheck: { status: "idle" },
    lint: { status: "idle" },
    page: { status: "idle" },
    followUp: { status: "idle" },
    onFixIt: () => {},
    pageRetry: { status: "available", run: () => {} },
    onRetryChecks: () => {},
  } satisfies ChecksBarViewProps,
};
export default meta;
type Story = StoryObj<typeof ChecksBarView>;

const ERRORS = {
  key: "typecheck_errors",
  failing: true,
  value: {
    newErrors: 2,
    errors: [
      {
        file: "src/components/Hero.tsx",
        line: 14,
        message: "Type 'number' is not assignable to type 'string'.",
      },
      {
        file: "src/components/Hero.tsx",
        line: 22,
        message: "Property 'subtitle' does not exist on type 'HeroProps'.",
      },
    ],
  },
};
const PAGE = {
  key: "page_check",
  failing: true,
  value: {
    status: "fail",
    summary: "The new heading is on the page, in the old colour.",
    findings: [
      {
        message: "h1 is black; the change made it the brand colour.",
        where: "main h1",
      },
    ],
  },
};

/** Right after a change: everything is being checked. */
export const Checking: Story = {
  args: {
    typecheck: { status: "running" },
    lint: { status: "running" },
    page: { status: "running" },
  },
};

/** All clear. */
export const Passed: Story = {
  args: {
    typecheck: { status: "ok" },
    lint: { status: "ok" },
    page: { status: "ok" },
  },
};

/** A check found something while the assistant was idle: it is fixing it. */
export const Fixing: Story = {
  args: {
    typecheck: { status: "problems", count: 2 },
    lint: { status: "ok" },
    page: { status: "running" },
    followUp: { status: "fixing", attempt: 1, of: 2 },
  },
};

/** The automatic fixes ran out: what is still wrong, and Fix it. */
export const StillFailing: Story = {
  args: {
    typecheck: { status: "problems", count: 2 },
    lint: { status: "ok" },
    page: { status: "problems", count: 1 },
    followUp: {
      status: "stopped",
      reason: "budget",
      attempts: 2,
      findings: [ERRORS, PAGE],
    },
  },
};

/** The last fix changed nothing the checks find: stopped early. */
export const NoProgress: Story = {
  args: {
    typecheck: { status: "problems", count: 2 },
    followUp: {
      status: "stopped",
      reason: "no-progress",
      attempts: 1,
      findings: [ERRORS],
    },
  },
};

/** Found after a reload, or in another tab: nothing ran on its own. */
export const FoundAfterReload: Story = {
  args: {
    lint: { status: "problems", count: 1 },
    followUp: {
      status: "stopped",
      reason: "budget",
      attempts: 0,
      findings: [
        {
          key: "lint_problems",
          failing: true,
          value: {
            problems: [
              {
                path: "src/content/home.val.ts",
                line: 2,
                message: "The module path is not this file's.",
              },
            ],
          },
        },
      ],
    },
  },
};

/** Our failure: the page check could not finish. Try again runs it; Details has what the service said. */
export const PageCheckFailed: Story = {
  args: {
    typecheck: { status: "ok" },
    lint: { status: "ok" },
    page: {
      status: "failed",
      message: "The AI service did not finish the page check.",
      details: "529 overloaded_error: Overloaded",
    },
  },
};

/** The same, with no page checks left until the person writes again. */
export const PageCheckFailedNoneLeft: Story = {
  args: {
    ...PageCheckFailed.args,
    pageRetry: { status: "limited" },
  },
};

/** The same, with the preview closed: there is no page to read. */
export const PageCheckFailedNoPreview: Story = {
  args: {
    ...PageCheckFailed.args,
    pageRetry: { status: "no-preview" },
  },
};

/** The typecheck could not run (adept or the network): Try again runs it. */
export const TypecheckCouldNotRun: Story = {
  args: {
    typecheck: {
      status: "failed",
      message: "The typecheck could not run.",
      details: "adept answered 503",
    },
    lint: { status: "ok" },
  },
};

/** A typecheck that fails for good: no Try again, which would fail again. */
export const TypecheckCannotRun: Story = {
  args: {
    ...TypecheckCouldNotRun.args,
    onRetryChecks: null,
  },
};

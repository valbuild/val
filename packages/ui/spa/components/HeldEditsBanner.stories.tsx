import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { action } from "storybook/actions";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { HeldEditsList, type HeldEditView } from "./HeldEditsBanner";

/**
 * Edits that stopped fitting when the code changed under them: what was
 * written, to copy and make again where the field is now, and a discard per
 * edit. Publishing waits for them.
 */
const PAGE = "/content/page.val.ts" as ModuleFilePath;

const heading: HeldEditView = {
  patchId: "p1" as PatchId,
  moduleFilePath: PAGE,
  changes: [
    {
      path: "heading",
      value: {
        kind: "text",
        text: "Spring sale: everything in the garden 20% off until May",
      },
    },
  ],
  why: "Cannot replace at heading: the object has no key heading",
};

const several: HeldEditView[] = [
  heading,
  {
    patchId: "p2" as PatchId,
    moduleFilePath: PAGE,
    changes: [
      {
        path: "cta.0",
        value: {
          kind: "text",
          text: JSON.stringify(
            { label: "Shop the sale", href: "/sale" },
            null,
            2,
          ),
        },
      },
    ],
    why: "Cannot add at cta.0: the object has no key cta",
  },
  {
    patchId: "p3" as PatchId,
    moduleFilePath: "/content/footer.val.ts" as ModuleFilePath,
    changes: [{ path: "legal", value: { kind: "removed" } }],
    why: "Cannot remove at legal: the object has no key legal",
  },
];

function Demo({
  edits,
  discard,
  assistant = false,
}: {
  edits: HeldEditView[];
  discard: "works" | "fails";
  /** Whether the assistant can be asked, which adds "Have the assistant move it". */
  assistant?: boolean;
}) {
  const [theme, setTheme] = useState<Themes | null>("dark");
  const [shown, setShown] = useState(edits);
  return (
    <ValThemeProvider theme={theme} setTheme={setTheme} config={undefined}>
      {shown.length > 0 ? (
        <HeldEditsList
          edits={shown}
          copy={action("copy")}
          {...(assistant ? { askAssistant: action("askAssistant") } : {})}
          onDiscard={async (patchIds) => {
            action("discard")(patchIds);
            await new Promise((resolve) => setTimeout(resolve, 400));
            if (discard === "fails") {
              return {
                status: "failed",
                message: "Val could not be reached",
              };
            }
            setShown((now) =>
              now.filter((edit) => !patchIds.includes(edit.patchId)),
            );
            return { status: "discarded" };
          }}
        />
      ) : (
        <p className="p-4 text-sm text-fg-secondary">
          Nothing held: the banner is gone, and publishing goes again.
        </p>
      )}
    </ValThemeProvider>
  );
}

const meta: Meta<typeof Demo> = {
  title: "Components/HeldEditsBanner",
  component: Demo,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-bg-tertiary">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Demo>;

/** One edit: its value, Copy, and Discard this edit. */
export const OneEdit: Story = {
  args: { edits: [heading], discard: "works" },
};

/** With the assistant connected: each edit can be handed to it to move. */
export const WithAssistant: Story = {
  args: { edits: several, discard: "works", assistant: true },
};

/** Several, in two modules: each discarded on its own, or all together. */
export const SeveralEdits: Story = {
  args: { edits: several, discard: "works" },
};

/**
 * The discard does not reach the server: the edit stays, the reason is said,
 * and Try again discards the same edit.
 */
export const DiscardFails: Story = {
  args: { edits: several, discard: "fails" },
};

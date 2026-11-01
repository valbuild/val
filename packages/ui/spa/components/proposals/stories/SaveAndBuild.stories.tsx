import type { Meta, StoryObj } from "@storybook/react";
import { action } from "storybook/actions";
import { useState } from "react";
import { ProposalActionButton } from "../ProposalBar";
import type { StudioLocation } from "../types";
import { mockSelectionIds } from "../../shell/mockShellData";
import { inProposal, shell } from "./proposalsShellHarness";

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;

/**
 * Save, when it builds too (`TopBarProposals.onSaveAndBuild`).
 *
 * Today a proposal whose code changed has two steps: Save, and then Build --
 * and with nothing unsaved, Save is disabled and the main half of the button
 * becomes Build. Proposed: ONE step. Save is enabled whenever there is a
 * build to make, even with nothing unsaved, and pressing it saves what there
 * is and then builds. The hammer beside "Save" says a build will follow.
 *
 * Each row is one state of the proposal, as the top bar's split button shows
 * it today and as it would. The caret opens the menu in both.
 */
const meta: Meta = {
  title: "Proposals/Save and build",
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;

const ROWS: { label: string; detail: string; location: InProposal }[] = [
  {
    label: "Content edited",
    detail: "No code changed: the same in both.",
    location: inProposal({ unsaved: 3 }),
  },
  {
    label: "Content edited, code changed",
    detail: "Proposed: one press saves the 3, then builds.",
    location: inProposal({ unsaved: 3, code: { state: "required" } }),
  },
  {
    label: "Code changed, all saved",
    detail: "Today: Build. Proposed: Save, enabled, with the hammer.",
    location: inProposal({ unsaved: 0, code: { state: "required" } }),
  },
  {
    label: "Saving",
    detail: "",
    location: inProposal({
      unsaved: 3,
      save: { state: "saving" },
      code: { state: "required" },
    }),
  },
  {
    label: "Building",
    detail: "Proposed: still the Save button, saying so.",
    location: inProposal({ unsaved: 0, code: { state: "building" } }),
  },
  {
    label: "Build failed",
    detail: "Proposed: pressing it builds again.",
    location: inProposal({
      unsaved: 0,
      code: {
        state: "failed",
        error: "Cannot find name 'Card'",
      },
    }),
  },
  {
    label: "Build tab blocked (Safari)",
    detail: "",
    location: inProposal({ unsaved: 0, code: { state: "blocked" } }),
  },
  {
    label: "Save failed",
    detail: "",
    location: inProposal({
      unsaved: 3,
      save: { state: "failed", error: "Val Build could not be reached" },
      code: { state: "required" },
    }),
  },
  {
    label: "Dependencies changed",
    detail: "Not a build of the code: its own step in both.",
    location: inProposal({
      unsaved: 0,
      code: { state: "lockfile", computing: false, error: null },
    }),
  },
  {
    label: "Saved and built",
    detail: "Nothing left but Publish, in both.",
    location: inProposal({ unsaved: 0 }),
  },
];

function Comparison({ theme }: { theme: "dark" | "light" }) {
  return (
    <div
      data-mode={theme}
      className="min-h-screen bg-bg-canvas p-8 font-sans text-fg-primary"
    >
      <div className="grid max-w-4xl grid-cols-[minmax(12rem,1fr)_auto_auto] items-center gap-x-10 gap-y-4">
        <div className="text-[0.6875rem] font-medium uppercase tracking-wide text-fg-secondary-alt">
          The proposal
        </div>
        <div className="text-[0.6875rem] font-medium uppercase tracking-wide text-fg-secondary-alt">
          Today
        </div>
        <div className="text-[0.6875rem] font-medium uppercase tracking-wide text-fg-secondary-alt">
          Proposed
        </div>
        {ROWS.map((row) => (
          <Row key={row.label} {...row} />
        ))}
      </div>
    </div>
  );
}

function Row({
  label,
  detail,
  location,
}: {
  label: string;
  detail: string;
  location: InProposal;
}) {
  return (
    <>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {detail !== "" && (
          <div className="text-xs text-fg-secondary">{detail}</div>
        )}
      </div>
      <ProposalActionButton
        location={location}
        onSave={action("save")}
        onBuild={action("build")}
        onPublish={action("publish")}
      />
      <ProposalActionButton
        location={location}
        onSave={action("save")}
        onBuild={action("build")}
        onSaveAndBuild={action("save, then build")}
        onPublish={action("publish")}
      />
    </>
  );
}

export const TodayAndProposed: StoryObj = {
  render: () => <Comparison theme="dark" />,
};

export const TodayAndProposedLight: StoryObj = {
  render: () => <Comparison theme="light" />,
};

/**
 * Pressable: the code changed and 2 content edits are unsaved. Save saves
 * them, then builds; when the build is served, the button is Publish.
 */
function Live({ theme }: { theme: "dark" | "light" }) {
  const [location, setLocation] = useState<InProposal>(
    inProposal({ unsaved: 2, code: { state: "required" } }),
  );
  const saveAndBuild = () => {
    const build = () => {
      setLocation((current) => ({ ...current, code: { state: "building" } }));
      setTimeout(
        () => setLocation((current) => ({ ...current, code: null })),
        2000,
      );
    };
    if (location.unsaved === 0) {
      build();
      return;
    }
    setLocation((current) => ({ ...current, save: { state: "saving" } }));
    setTimeout(() => {
      setLocation((current) => ({
        ...current,
        save: { state: "idle" },
        unsaved: 0,
      }));
      build();
    }, 900);
  };
  return (
    <div
      data-mode={theme}
      className="flex min-h-screen flex-col items-start gap-4 bg-bg-canvas p-8 font-sans text-fg-primary"
    >
      <ProposalActionButton
        location={location}
        onSave={action("save")}
        onBuild={action("build")}
        onSaveAndBuild={saveAndBuild}
        onPublish={action("publish")}
      />
      <button
        type="button"
        onClick={() =>
          setLocation(inProposal({ unsaved: 2, code: { state: "required" } }))
        }
        className="text-xs text-fg-secondary underline"
      >
        Start over
      </button>
    </div>
  );
}

export const Pressable: StoryObj = {
  render: () => <Live theme="dark" />,
};

/** In the whole Studio: code changed, everything saved -- Save is enabled. */
export const InTheStudio = shell({
  location: inProposal({ unsaved: 0, code: { state: "required" } }),
  selectionId: mockSelectionIds.home,
  saveBuilds: true,
  codeMode: {},
});

/** Its menu: Save and build together, Publish below. */
export const InTheStudioMenuOpen = shell({
  location: inProposal({ unsaved: 2, code: { state: "required" } }),
  selectionId: mockSelectionIds.home,
  saveBuilds: true,
  codeMode: {},
  menuOpen: true,
});

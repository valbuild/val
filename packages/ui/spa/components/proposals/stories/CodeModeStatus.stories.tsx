import type { Meta, StoryObj } from "@storybook/react";
import { action } from "storybook/actions";
import { useEffect, useState } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import {
  CODE_MODE_STATUS_VARIANTS,
  CodeModeProgressLine,
  CodeModeStatus,
  type CodeModeBuild,
  type CodeModeStatusVariant,
} from "../CodeModeStatus";

/**
 * Four ways to show whether code mode's preview is up to date, to choose
 * between. All of them sit where the reload button is, at the end of the
 * code mode toolbar, and keep one width in every state -- so nothing in the
 * toolbar moves when the status changes. None says "build": the person sees
 * a preview, so the status is about the preview.
 *
 * - `reload` -- the arrow turns while it updates, the percentage beside it;
 *   a dot when it is behind (amber) or could not update (red).
 * - `label` -- the same with words: "Up to date", "Updating 42%", "Save to
 *   update", "Couldn't update".
 * - `ring` -- no text: a ring fills around the arrow.
 * - `line` -- a hairline fills along the foot of the toolbar.
 *
 * Words are always in the tooltip, and read out to screen readers. When it
 * could not update, the button opens what happened, with the error under
 * Details and "Ask the assistant to fix it".
 */
const meta: Meta = {
  title: "Proposals/Code mode status",
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;

const ERROR =
  "src/components/sections/Testimonials.tsx(5,22): error TS2304: Cannot find name 'Card'.";

const STATES: { label: string; build: CodeModeBuild }[] = [
  { label: "Up to date", build: { state: "up-to-date" } },
  { label: "Behind (Save to update)", build: { state: "behind" } },
  {
    label: "Updating, no estimate",
    build: { state: "updating", progress: null },
  },
  { label: "Updating 8%", build: { state: "updating", progress: 0.08 } },
  { label: "Updating 42%", build: { state: "updating", progress: 0.42 } },
  { label: "Updating 100%", build: { state: "updating", progress: 1 } },
  {
    label: "Couldn't update",
    build: {
      state: "failed",
      error: ERROR,
      onAskAssistant: action("ask the assistant to fix it"),
    },
  },
];

/** The code mode toolbar, as it is in the Studio, with the status at its end. */
function Toolbar({
  build,
  variant,
}: {
  build: CodeModeBuild;
  variant: CodeModeStatusVariant;
}) {
  return (
    <div className="relative flex h-10 w-[34rem] items-center gap-2 rounded-t-lg border border-border-proposal bg-bg-float px-2">
      <div className="inline-flex h-7 items-center rounded-md border border-border-float p-0.5 text-xs">
        <span className="rounded bg-bg-float-raised px-2 py-1 font-medium text-fg-primary">
          Preview
        </span>
        <span className="whitespace-nowrap px-2 text-fg-secondary">
          Changes <span className="text-fg-secondary-alt">4</span>
        </span>
      </div>
      <span className="inline-flex h-7 w-24 items-center rounded-md border border-border-float px-2 font-mono text-xs">
        /
      </span>
      <span className="inline-flex items-center text-fg-secondary">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-bg-float-raised text-fg-primary">
          <Monitor size={14} />
        </span>
        <span className="grid h-7 w-7 place-items-center">
          <Tablet size={14} />
        </span>
        <span className="grid h-7 w-7 place-items-center">
          <Smartphone size={14} />
        </span>
      </span>
      <div className="flex-1" />
      <CodeModeStatus
        build={build}
        variant={variant}
        onReload={action("reload the preview")}
      />
      {variant === "line" && <CodeModeProgressLine build={build} />}
    </div>
  );
}

function Grid({ theme }: { theme: "dark" | "light" }) {
  return (
    <div
      data-mode={theme}
      className="min-h-screen bg-bg-canvas p-8 font-sans text-fg-primary"
    >
      <div className="grid grid-cols-[10rem_repeat(2,auto)] items-center gap-x-8 gap-y-5">
        {CODE_MODE_STATUS_VARIANTS.map((variant) => (
          <Section key={variant} variant={variant} />
        ))}
      </div>
    </div>
  );
}

function Section({ variant }: { variant: CodeModeStatusVariant }) {
  return (
    <>
      <div className="col-span-3 mt-4 border-t border-border-float pt-4 font-mono text-sm font-medium">
        {variant}
      </div>
      {STATES.map((state) => (
        <Pair key={state.label} label={state.label}>
          <Toolbar build={state.build} variant={variant} />
        </Pair>
      ))}
    </>
  );
}

function Pair({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="text-xs text-fg-secondary">{label}</div>
      <div className="col-span-2">{children}</div>
    </>
  );
}

/** Every option, in every state. */
export const AllOptions: StoryObj = {
  render: () => <Grid theme="dark" />,
};

export const AllOptionsLight: StoryObj = {
  render: () => <Grid theme="light" />,
};

/**
 * Every option at once, going round: up to date, behind, an update from 0 to
 * 100 %, up to date -- and every third round, one that could not update.
 * Watch the tabs and the page box: they never move.
 */
function Live({ theme }: { theme: "dark" | "light" }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 350);
    return () => clearInterval(timer);
  }, []);
  const round = Math.floor(tick / 22);
  const at = tick % 22;
  const build: CodeModeBuild =
    at < 4
      ? { state: "up-to-date" }
      : at < 7
        ? { state: "behind" }
        : at < 18
          ? { state: "updating", progress: (at - 7) / 10 }
          : round % 3 === 2
            ? { state: "failed", error: ERROR }
            : { state: "up-to-date" };
  return (
    <div
      data-mode={theme}
      className="flex min-h-screen flex-col gap-4 bg-bg-canvas p-8 font-sans text-fg-primary"
    >
      {CODE_MODE_STATUS_VARIANTS.map((variant) => (
        <div key={variant} className="flex items-center gap-6">
          <div className="w-16 font-mono text-xs text-fg-secondary">
            {variant}
          </div>
          <Toolbar build={build} variant={variant} />
        </div>
      ))}
    </div>
  );
}

export const Running: StoryObj = {
  render: () => <Live theme="dark" />,
};

export const RunningLight: StoryObj = {
  render: () => <Live theme="light" />,
};

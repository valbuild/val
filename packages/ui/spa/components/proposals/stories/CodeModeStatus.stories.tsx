import type { Meta, StoryObj } from "@storybook/react";
import { action } from "storybook/actions";
import { useEffect, useState } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { CodeModeStatus, type CodeModeBuild } from "../CodeModeStatus";

/**
 * Whether code mode's preview is up to date, in two or three words in the
 * reload button at the end of the code mode toolbar: "Up to date", "Save to
 * update", "Updating 42%", "Couldn't update". It keeps one width in every
 * state, so nothing in the toolbar moves when the status changes, and it
 * never says "build": the person sees a preview, so the status is about the
 * preview. Every step that makes one -- the packages, the code -- is one
 * "Updating", with one percentage.
 *
 * When it could not update, the button opens what happened, with the error
 * under Details and "Ask the assistant to fix it".
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
function Toolbar({ build }: { build: CodeModeBuild }) {
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
      <CodeModeStatus build={build} onReload={action("reload the preview")} />
    </div>
  );
}

function Grid({ theme }: { theme: "dark" | "light" }) {
  return (
    <div
      data-mode={theme}
      className="min-h-screen bg-bg-canvas p-8 font-sans text-fg-primary"
    >
      <div className="grid grid-cols-[10rem_auto] items-center gap-x-8 gap-y-5">
        {STATES.map((state) => (
          <Pair key={state.label} label={state.label}>
            <Toolbar build={state.build} />
          </Pair>
        ))}
      </div>
    </div>
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
      <div>{children}</div>
    </>
  );
}

/** Every state. */
export const AllStates: StoryObj = {
  render: () => <Grid theme="dark" />,
};

export const AllStatesLight: StoryObj = {
  render: () => <Grid theme="light" />,
};

/**
 * Going round: up to date, behind, an update from 0 to 100 %, up to date --
 * and every third round, one that could not update. Watch the tabs and the
 * page box: they never move.
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
      <Toolbar build={build} />
    </div>
  );
}

export const Running: StoryObj = {
  render: () => <Live theme="dark" />,
};

export const RunningLight: StoryObj = {
  render: () => <Live theme="light" />,
};

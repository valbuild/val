import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Checkbox } from "./checkbox";

/**
 * Every state a checkbox has, in both themes.
 *
 * Switch the theme from the toolbar. Before this component was fixed the
 * unchecked box was invisible here: the border named a token from the dead
 * shadcn block, which in a document resolves to #fcfcfc.
 */
const meta: Meta<typeof Checkbox> = {
  title: "DesignSystem/Checkbox",
  component: Checkbox,
  parameters: { layout: "centered" },
};
export default meta;

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 text-xs text-fg-secondary-alt">{label}</span>
      {children}
    </div>
  );
}

export const States: StoryObj = {
  render: () => (
    <div className="space-y-6">
      {(
        [
          ["On the page", "bg-bg-primary"],
          ["On a panel", "bg-bg-float"],
          ["On a raised panel", "bg-bg-float-raised"],
        ] as const
      ).map(([surface, className]) => (
        <div
          key={surface}
          className={`${className} p-4 rounded-lg border border-border-float space-y-2.5`}
        >
          <p className="text-[0.6875rem] uppercase tracking-wide text-fg-secondary-alt">
            {surface}
          </p>
          <Row label="Unchecked">
            <Checkbox aria-label="Unchecked" checked={false} />
          </Row>
          <Row label="Checked">
            <Checkbox aria-label="Checked" checked />
          </Row>
          <Row label="Indeterminate">
            <Checkbox aria-label="Indeterminate" checked="indeterminate" />
          </Row>
          <Row label="Disabled">
            <Checkbox aria-label="Disabled" checked disabled />
          </Row>
          <Row label="Small (3.5)">
            <Checkbox aria-label="Small" checked className="w-3.5 h-3.5" />
          </Row>
        </div>
      ))}
    </div>
  ),
};

/** Click it. The tick has to appear without anyone holding the state. */
export const Uncontrolled: StoryObj = {
  render: () => (
    <div className="space-y-2.5 p-4">
      <Row label="Starts unchecked">
        <Checkbox aria-label="Starts unchecked" />
      </Row>
      <Row label="Starts checked">
        <Checkbox aria-label="Starts checked" defaultChecked />
      </Row>
      <Row label="Controlled">
        <Controlled />
      </Row>
    </div>
  ),
};

function Controlled() {
  const [checked, setChecked] = useState<boolean | "indeterminate">(
    "indeterminate",
  );
  return (
    <Checkbox
      aria-label="Controlled"
      checked={checked}
      onCheckedChange={(next) => setChecked(next)}
    />
  );
}

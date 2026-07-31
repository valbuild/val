import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { ValPortalProvider, useValPortal } from "./ValPortalProvider";
import { Toaster, toast } from "./designSystem/sonner";
import { TransientErrorsList, TransientError } from "./DraftChanges";
import { Button } from "./designSystem/button";

const sampleErrors: TransientError[] = [
  {
    id: "1",
    message: "Failed to save changes",
    details: "Network error: 503 Service Unavailable",
    timestamp: Date.now() - 1000 * 60 * 2,
  },
  {
    id: "2",
    message: "Content at '/content/page.val.ts' is not yet initialized",
    timestamp: Date.now() - 1000 * 30,
  },
  {
    id: "3",
    message: "Failed to publish changes",
    details: "Some changes have errors. A developer might need to take a look.",
    timestamp: Date.now() - 1000 * 60 * 60,
  },
];

/**
 * Interactive harness: errors live in local state (standing in for the
 * transient-error queue). Adding one fires a sonner toast and appends to the
 * list, mirroring how TransientErrorToasts + TransientErrorsDisplay behave in
 * the app.
 */
function Demo({ initialErrors }: { initialErrors: TransientError[] }) {
  const [theme, setTheme] = useState<Themes | null>("dark");
  const [errors, setErrors] = useState<TransientError[]>(initialErrors);
  const counter = useRef(initialErrors.length);

  const addError = (withDetails: boolean) => {
    counter.current += 1;
    const id = `gen-${counter.current}`;
    const message = `Generated transient error #${counter.current}`;
    const details = withDetails
      ? "Some extra debugging context about what went wrong."
      : undefined;
    setErrors((prev) => [
      ...prev,
      { id, message, details, timestamp: Date.now() },
    ]);
    toast.error(message, { id, description: details, duration: 6000 });
  };

  return (
    <ValThemeProvider theme={theme} setTheme={setTheme} config={undefined}>
      <ValPortalProvider>
        <DemoInner
          theme={theme}
          setTheme={setTheme}
          errors={errors}
          onAdd={addError}
          onDismiss={(id) =>
            setErrors((prev) => prev.filter((e) => e.id !== id))
          }
          onClear={() => setErrors([])}
        />
        <Toaster />
      </ValPortalProvider>
    </ValThemeProvider>
  );
}

function DemoInner({
  theme,
  setTheme,
  errors,
  onAdd,
  onDismiss,
  onClear,
}: {
  theme: Themes | null;
  setTheme: (theme: Themes | null) => void;
  errors: TransientError[];
  onAdd: (withDetails: boolean) => void;
  onDismiss: (id: string) => void;
  onClear: () => void;
}) {
  const container = useValPortal();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onAdd(false)}>Add error (toast)</Button>
        <Button onClick={() => onAdd(true)}>Add error with details</Button>
        <Button
          variant="outline"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          Toggle theme ({theme})
        </Button>
      </div>
      <p className="text-sm text-fg-secondary">
        The bell icon below is the sidebar entry — a red dot appears when there
        are unseen errors. Click it to open the full list. Newly added errors
        also pop up as auto-dismissing toasts.
      </p>
      <div className="flex items-center gap-2 w-[320px] border border-border-primary rounded-md p-2">
        <TransientErrorsList
          errors={errors}
          container={container}
          onDismiss={onDismiss}
          onClear={onClear}
        />
        {errors.length === 0 ? (
          <span className="text-sm text-fg-secondary">
            No transient errors (the button is hidden, just like in the app).
          </span>
        ) : (
          <span className="text-sm text-fg-secondary">
            {errors.length} error{errors.length > 1 ? "s" : ""} in the list
          </span>
        )}
      </div>
    </div>
  );
}

const meta: Meta<typeof Demo> = {
  title: "Components/TransientErrors",
  component: Demo,
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
type Story = StoryObj<typeof Demo>;

export const WithErrors: Story = {
  args: { initialErrors: sampleErrors },
};

export const Empty: Story = {
  args: { initialErrors: [] },
};

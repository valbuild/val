import { Toaster as SonnerToaster, toast } from "sonner";
import { useTheme } from "../ValThemeProvider";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/**
 * Val-themed wrapper around sonner's Toaster.
 *
 * Differences from the stock shadcn wrapper:
 * - Theme comes from Val's own ValThemeProvider (not next-themes).
 * - Toasts are styled with Val's error color tokens so transient errors match
 *   the rest of the UI.
 * - `position` defaults to bottom-center to avoid overlapping the left nav and
 *   right tools sidebars.
 *
 * NOTE: sonner injects its base stylesheet into document.head, which does not
 * reach the Shadow DOM the Val UI renders in. The stylesheet is therefore
 * imported into spa/index.css (served into the shadow root) instead.
 */
export function Toaster(props: ToasterProps) {
  const { theme } = useTheme();
  return (
    <SonnerToaster
      theme={theme ?? "light"}
      position="bottom-center"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group rounded-lg border border-border-primary shadow-lg font-serif",
          error:
            "bg-bg-error-primary text-fg-error-primary border-border-primary",
          title: "font-bold",
          description: "text-fg-error-primary opacity-90",
          icon: "text-fg-error-primary",
          closeButton:
            "bg-bg-error-primary text-fg-error-primary border-border-primary",
        },
      }}
      {...props}
    />
  );
}

export { toast };

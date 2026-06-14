import { Toaster as SonnerToaster, toast } from "sonner";
import { useTheme } from "../ValThemeProvider";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/**
 * Val-themed wrapper around sonner's Toaster.
 *
 * Differences from the stock shadcn wrapper:
 * - Theme comes from Val's own ValThemeProvider (not next-themes).
 * - Toasts use a neutral surface with a red error icon (rather than a fully red
 *   fill) so they read as alerts without being visually loud.
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
            "group rounded-lg border border-border-primary bg-bg-primary text-fg-primary shadow-lg font-serif",
          title: "font-bold",
          description: "text-fg-secondary",
          icon: "text-fg-error-secondary",
          closeButton:
            "bg-bg-primary text-fg-secondary border-border-primary hover:text-fg-primary",
        },
      }}
      {...props}
    />
  );
}

export { toast };

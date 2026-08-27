import type { Decorator, Preview } from "@storybook/react";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import { TooltipProvider } from "../spa/components/designSystem/tooltip";
import { ValPortalProvider } from "../spa/components/ValPortalProvider";
import { ValThemeProvider, Themes } from "../spa/components/ValThemeProvider";

import "tailwindcss/tailwind.css";
import "../spa/index.css";

/**
 * The Studio providers that practically every component needs.
 *
 * The live app mounts these in `ValProvider`, and their contexts throw rather
 * than fall back to a default: `useValPortal` and `useTheme` both read through
 * a Proxy that raises "Cannot use ...Context outside of ...Provider". A story
 * that renders a component with a popover, dropdown or tooltip anywhere in its
 * subtree therefore crashes with a blank canvas unless the providers are
 * present, which is not something the story author can see coming from the
 * component's props.
 *
 * Mounting them globally keeps a story's own decorators about the data it
 * needs (sources, schemas, routing). Stories that already nest their own copy
 * of these providers keep working - the inner provider wins.
 */
const withValProviders: Decorator = (Story, context) => {
  const theme: Themes = context.globals.theme === "light" ? "light" : "dark";
  return (
    <ValThemeProvider theme={theme} setTheme={() => {}} config={undefined}>
      <ValPortalProvider>
        <TooltipProvider>
          <Story />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>
  );
};

const preview: Preview = {
  decorators: [
    withValProviders,
    withThemeByDataAttribute({
      themes: {
        light: "light",
        dark: "dark",
      },
      defaultTheme: "dark",
      attributeName: "data-mode",
    }),
  ],
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
  },
};

export default preview;

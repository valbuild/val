import React from "react";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import { TooltipProvider } from "../spa/components/designSystem/tooltip";

import "tailwindcss/tailwind.css";
import "../spa/index.css";

/* snipped for brevity */

export const decorators = [
  withThemeByDataAttribute({
    themes: {
      light: "light",
      dark: "dark",
    },
    defaultTheme: "dark",
    attributeName: "data-mode",
  }),
  // Many components (e.g. the NavMenu's error badges) use Radix Tooltip
  // which requires a TooltipProvider ancestor. The live app mounts one in
  // `ValProvider`; Storybook needs its own.
  (Story) =>
    React.createElement(TooltipProvider, null, React.createElement(Story)),
];

/** @type { import('@storybook/react').Preview } */
const preview = {
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

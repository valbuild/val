import { withThemeByDataAttribute } from "@storybook/addon-themes";

import "tailwindcss/tailwind.css";
import "../spa/index.css";
import "./theme.css"; // The normal css has theming on :hover, but we need to have it on :root for stories to work

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

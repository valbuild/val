/** @type { import('@storybook/react').Preview } */
import "tailwindcss/tailwind.css";

const preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    backgrounds: {
      default: "valDarkGrey",
      values: [
        {
          name: "valDarkGrey",
          value: "#575757",
        },
        {
          name: "valWhite",
          value: "##FCFCFC",
        },
        {
          name: "valWarmBlack",
          value: "#1A1A1A",
        }
      ],
    },
  },
};

export default preview;

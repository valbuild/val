/** @type { import('@storybook/react-vite').StorybookConfig } */
const config = {
  stories: ["../spa/**/*.mdx", "../spa/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: [
    "@storybook/addon-links",
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
    "@storybook/addon-themes",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {
      options: { builder: { useSWC: true } },
    },
  },
  docs: {
    autodocs: "tag",
  },
};
export default config;

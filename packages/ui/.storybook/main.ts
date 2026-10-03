import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../spa/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: [
    // Docs is its own addon since Storybook 9 - it used to arrive with
    // `addon-essentials`, which no longer exists. It is what makes the
    // `autodocs` tag the stories carry generate a Docs page.
    "@storybook/addon-docs",
    "@storybook/addon-links",
    "@storybook/addon-themes",
  ],
  // Media the stories play: a video, an HLS stream (a directory, so it cannot
  // be a hashed import), its poster and captions. Here rather than in
  // `public/`, which the SPA build copies into what is published.
  staticDirs: [{ from: "./static/media", to: "/storybook-media" }],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
};

export default config;

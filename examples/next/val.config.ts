import { initVal } from "@valbuild/next";

const { s, c, val, config, nextAppRouter, externalPageRouter } = initVal({
  project: "valbuild/val-examples-next",
  root: "/examples/next",
  defaultTheme: "dark",
  ai: {
    chat: {
      experimental: {
        enable: false,
      },
      suggestions: [
        "Summarize",
        "Fix typos at this page",
        "Create a blog page",
      ],
      title: "Ask me anything",
      description:
        "Val can answer questions about the content and how it was built.",
    },
  },
});

export type { t } from "@valbuild/next";
export { s, c, val, config, nextAppRouter, externalPageRouter };

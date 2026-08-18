import { initVal } from "@valbuild/next";

const { s, c, val, config, nextAppRouter, externalPageRouter } = initVal({
  project: "valbuild/val-examples-next",
  root: "/examples/next",
  defaultTheme: "dark",
  // Render content saved in Val before it has been deployed. Only takes effect
  // in remote mode (VAL_API_KEY + VAL_SECRET + VAL_GIT_COMMIT); running the
  // example locally logs a warning and ignores it.
  live: {
    ttl: 60,
    staleWhileRevalidate: 300,
  },
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

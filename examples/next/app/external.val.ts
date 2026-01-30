import { c, s, externalPageRouter } from "../val.config";

export default c.define(
  "/app/external.val.ts",
  s.router(externalPageRouter, s.object({ title: s.string() })),
  {
    "https://www.google.com": { title: "Google" },
    "https://www.youtube.com": { title: "YouTube" },
    "https://www.facebook.com": { title: "Facebook" },
    "https://www.twitter.com": { title: "Twitter" },
    "https://www.instagram.com": { title: "Instagram" },
    "https://www.linkedin.com": { title: "LinkedIn" },
    "https://www.github.com": { title: "GitHub" },
  },
);

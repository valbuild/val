import { createFileRoute } from "@tanstack/react-router";
import { valApiHandler } from "../../val/server";

/** The Val API route. In the demo, only the Studio's own files. */
export const Route = createFileRoute("/api/val/$")({
  server: {
    handlers: {
      GET: ({ request }) => valApiHandler(request),
      POST: ({ request }) => valApiHandler(request),
      PUT: ({ request }) => valApiHandler(request),
      PATCH: ({ request }) => valApiHandler(request),
      DELETE: ({ request }) => valApiHandler(request),
      HEAD: ({ request }) => valApiHandler(request),
    },
  },
});

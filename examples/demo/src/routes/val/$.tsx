import { createFileRoute } from "@tanstack/react-router";

// Everything under `/val`, so the Studio's own client-side navigation
// (`/val/~/...`) resolves on a reload too.
export const Route = createFileRoute("/val/$")({
  component: () => null,
});

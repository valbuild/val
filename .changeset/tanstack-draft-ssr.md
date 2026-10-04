---
"@valbuild/tanstack": patch
"@valbuild/server": patch
---

A draft page on TanStack Start is now rendered as the draft by the server, so it no longer shows the published text first and the draft a moment later — most noticeable when you reload right after publishing.

Read the request's draft in your site layout's loader and pass it to `ValProvider`:

```tsx
// src/val/server.ts
export const { fetchValDraft /* , fetchVal, ... */ } = initValContent(
  config,
  valModules,
  { draftMode },
);

// src/routes/_site.tsx
const getValDraft = createServerFn().handler(() => fetchValDraft());

export const Route = createFileRoute("/_site")({
  loader: () => (typeof document === "undefined" ? getValDraft() : null),
  component: SiteLayout,
});

function SiteLayout() {
  const draft = Route.useLoaderData();
  return (
    <ValProvider config={config} suspend draft={draft}>
      {/* ... */}
    </ValProvider>
  );
}
```

Visitors pay one cookie lookup and nothing else. Without `draft`, pages behave as before.

Also: a draft's `.jsonValues()` entries now include changes that were published after the build being served, instead of showing the old value until the next build is live.

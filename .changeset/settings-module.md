---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/next": minor
"@valbuild/cli": minor
---

`s.settings()`: the project's settings, as content.

A settings module is one per project, at the root of the content tree:

```typescript
// settings.val.ts
export default c.define("/settings.val.ts", s.settings(), {});
```

Register it in `val.modules.ts` like any other module, and it shows up in the
Studio under the cog at the foot of the left rail. Everything in it is content:
it is edited as a draft, it appears in the publish diff, and it is the same for
everyone working on the project.

Every key is optional, at every level, so `{}` is a complete settings module —
and stays one as sections are added. What it holds today is the assistant:

```typescript
export default c.define("/settings.val.ts", s.settings(), {
  ai: {
    enabled: true,
    context: "A CMS for developers, run by a team of four in Oslo.",
    tone: "Plain and direct. British English, sentence case in headings.",
  },
});
```

`context` is background the assistant would otherwise guess at; `tone` is how it
should write when it writes content. Both are sent with every message it makes.
`enabled` decides whether editors have an assistant at all — and unset means on,
so a project that fills in its AI section does not have to say so.

**Breaking: `ai.chat` is gone from `val.config.ts`.** Whether the assistant is
available is a decision about the project's content, made by the people who edit
it, so it moved to settings — turning the chat on used to take a developer, a
deploy and a code review of a boolean. Remove the whole block:

```diff
 const { s, c, val, config } = initVal({
-  ai: {
-    chat: {
-      experimental: { enable: true },
-      suggestions: ["Summarize", "Fix typos at this page"],
-      title: "Ask me anything",
-      description: "Val can answer questions about the content.",
-    },
-  },
 });
```

`experimental.enable` becomes `ai.enabled` in the settings module. `suggestions`,
`title` and `description` are removed with nothing replacing them: the assistant
now opens with its own copy. Note that the assistant is **on by default** for a
project that has a settings module and does not say otherwise, and for one that
has no settings module at all — a project with no reachable model still gets no
assistant, as before.

`ai.commitMessages` stays in `val.config.ts`, and is unaffected.

Two settings modules, or one in a subdirectory, is a module error: the dev
server refuses to serve sources, `npx val validate` reports it against the file,
and the Studio says so rather than picking one.

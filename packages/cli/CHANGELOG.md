# @valbuild/cli

## 0.121.0

### Minor Changes

- [#605](https://github.com/valbuild/val/pull/605) [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79) Thanks [@freekh](https://github.com/freekh)! - `s.settings()`: the project's settings, as content.

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
    assistant: {
      enabled: true,
      context: "A CMS for developers, run by a team of four in Oslo.",
      tone: "Plain and direct. British English, sentence case in headings.",
    },
  });
  ```

  `context` is background the assistant would otherwise guess at; `tone` is how it
  should write when it writes content. Both are sent with every message it makes.

  `enabled` decides whether editors have an assistant, and it has **three** states
  rather than two:

  - `true` — they do.
  - `false` — they do not, and every trace of it goes: no button in the top bar,
    no row in the quick actions, no panel, nothing sent.
  - unset — nobody has decided. The assistant is still **shown**, and asks to be
    turned on before it is used. Hiding an assistant nobody has decided about
    means nobody discovers it; quietly enabling one means a project starts sending
    its content to a model because it did not know to say no.

  A project with no settings module at all has an assistant, as before: there is
  nowhere to record a decision, and nowhere for the prompt to write the answer.

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

  `experimental.enable` becomes `assistant.enabled` in the settings module.
  `suggestions`, `title` and `description` are removed with nothing replacing
  them: the assistant now opens with its own copy. A project that had the chat
  enabled and wants it to stay on for everyone should write
  `assistant: { enabled: true }` — otherwise editors are offered it and asked.

  `ai.commitMessages` stays in `val.config.ts`, and is unaffected.

  Two settings modules, or one in a subdirectory, is a module error: the dev
  server refuses to serve sources, `npx val validate` reports it against the file,
  and the Studio says so rather than picking one.

### Patch Changes

- Updated dependencies [[`2bcc6fd`](https://github.com/valbuild/val/commit/2bcc6fdff8d668123e07e3c5e81ac6fa1436e47b), [`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2), [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79)]:
  - @valbuild/shared@0.121.0
  - @valbuild/server@0.121.0
  - @valbuild/core@0.121.0
  - @valbuild/language-server@0.121.0

## 0.120.4

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.120.4
  - @valbuild/language-server@0.120.4

## 0.120.3

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.120.3
  - @valbuild/language-server@0.120.3

## 0.120.2

### Patch Changes

- [#593](https://github.com/valbuild/val/pull/593) [`095ee0d`](https://github.com/valbuild/val/commit/095ee0dd011b069c30bc99ae58356e28796e106b) Thanks [@freekh](https://github.com/freekh)! - Publish the packages that 0.120.1 did not reach.

  `@valbuild/server@0.120.1` made it to npm, but `@valbuild/cli`,
  `@valbuild/language-server` and `@valbuild/next` did not — the release job
  failed part-way through, and the version numbers it had already claimed could
  not be reused. This release carries the same contents for those three packages:
  they pick up the MCP signing-key rotation fix from `@valbuild/server@0.120.1`,
  and there is nothing else in it.

  If you are on 0.120.0, upgrade straight to this version. There is no 0.120.1 of
  these three packages, and there will not be one.

- Updated dependencies [[`095ee0d`](https://github.com/valbuild/val/commit/095ee0dd011b069c30bc99ae58356e28796e106b)]:
  - @valbuild/language-server@0.120.2

## 0.120.1

### Patch Changes

- Updated dependencies [[`6f318d4`](https://github.com/valbuild/val/commit/6f318d406295b772e721bf463283f47e2822e996)]:
  - @valbuild/server@0.120.1
  - @valbuild/language-server@0.120.1

## 0.120.0

### Patch Changes

- Updated dependencies [[`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a)]:
  - @valbuild/core@0.120.0
  - @valbuild/shared@0.120.0
  - @valbuild/language-server@0.120.0
  - @valbuild/server@0.120.0

## 0.119.0

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.119.0
  - @valbuild/language-server@0.119.0

## 0.118.0

### Patch Changes

- Updated dependencies [[`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95)]:
  - @valbuild/server@0.118.0
  - @valbuild/shared@0.118.0
  - @valbuild/language-server@0.118.0

## 0.117.1

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.117.1
  - @valbuild/language-server@0.117.1

## 0.117.0

### Patch Changes

- Updated dependencies [[`fca3efa`](https://github.com/valbuild/val/commit/fca3efa389e2817401f55ea3dd184af7c611b807), [`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f), [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d)]:
  - @valbuild/server@0.117.0
  - @valbuild/language-server@0.117.0
  - @valbuild/core@0.117.0
  - @valbuild/shared@0.117.0

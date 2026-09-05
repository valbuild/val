# @valbuild/next

## 0.122.0

### Minor Changes

- [#597](https://github.com/valbuild/val/pull/597) [`5d14612`](https://github.com/valbuild/val/commit/5d14612f612d657a37338136188f2b3c02b28fe7) Thanks [@freekh](https://github.com/freekh)! - MCP: remove personal access token auth. The endpoint now needs an `oauth`
  config, or local filesystem mode.

  Until now, an MCP endpoint with no `oauth` config accepted whatever bearer token
  a caller presented and relayed it to the Val content backend unread. The
  reasoning was that without an issuer the app has no key to check a token
  against, so it should not pretend to be the authority on what that token may
  do — and that much was right. The shape was not: a credential the app cannot
  check is one it cannot refuse either, so "a deployed endpoint that authenticates
  nobody" was a supported configuration, and an app could serve content-rewriting
  tools without ever being told where its callers should authorize.

  **If you run Val in proxy mode**, MCP now requires the `oauth` config that
  shipped in `0.120.0`. Callers authorize as themselves against the Val
  authorization server, this app verifies the token's signature, issuer, audience
  and expiry itself, and patches carry the verified profile as their author:

  ```ts
  initValMcp(valModules, config, {
    oauth: {
      issuer: "https://admin.val.build",
      resource: "https://your-app.com/api/mcp",
    },
  });
  ```

  Leave it out and the endpoint answers `500` naming the missing config, rather
  than serving the request.

  **If you run Val in local filesystem mode**, nothing changes. Local development
  still needs no `oauth` config and no authorization server: there is no backend
  to authenticate to, and patches are written with no author. A token presented
  to such a project is still refused rather than ignored — the endpoint answers
  `400` and says to take the credential out of the client's configuration, since
  what it reached was a working tree with no permission check in front of it.

  Two API changes if you built your own host on `createValTools`:

  - `ValToolContext.auth` no longer has a `{ type: "pat", pat }` variant.
    `{ type: "verified-profile", profileId, scopes }` is the only credential the
    registry accepts, and `null` still means local filesystem mode.
  - `createValOps` no longer takes an `auth` argument. `ValOpsHttp` still accepts
    a personal access token directly — that is how `val debug` uses the token from
    `val login` — but no server request builds one.

  Proxy mode also stops keeping one data layer per credential. Each personal
  access token needed its own `ValOpsHttp` to hold it, each of those cached the
  project's evaluated modules, and the bounded cache that kept the memory in
  check turned an eviction into a re-evaluation of every module on the next call.
  Verified callers all share one instance, because they all reach the backend
  under the app's own API key.

### Patch Changes

- Updated dependencies [[`5d14612`](https://github.com/valbuild/val/commit/5d14612f612d657a37338136188f2b3c02b28fe7), [`1c8b7fd`](https://github.com/valbuild/val/commit/1c8b7fda1e84cd8bd32a03a85d2789598b98c3fb)]:
  - @valbuild/server@0.122.0
  - @valbuild/ui@0.122.0
  - @valbuild/language-server@0.122.0
  - @valbuild/react@0.122.0

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

- [#607](https://github.com/valbuild/val/pull/607) [`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2) Thanks [@freekh](https://github.com/freekh)! - `.readonly()` and `.hidden()` now take the flag as an argument, so a schema can
  decide these from a variable instead of only from whether the call was written at
  all:

  ```ts
  s.string().readonly(!canEdit);
  s.image().hidden(hideMedia);
  ```

  The argument defaults to `true`, so `.readonly()` and `.readonly(true)` are the
  same thing and nothing about existing schemas changes. Passing `false` leaves the
  field editable or visible, which is also what a schema is without the call - it
  is there so the flag can come from a variable.

- Updated dependencies [[`105479b`](https://github.com/valbuild/val/commit/105479b84a08846f1fe5971916f6a54275198d12), [`55ec736`](https://github.com/valbuild/val/commit/55ec73651394908b6f440e360d181b95a91c0a93), [`2bcc6fd`](https://github.com/valbuild/val/commit/2bcc6fdff8d668123e07e3c5e81ac6fa1436e47b), [`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2), [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79), [`2db27d5`](https://github.com/valbuild/val/commit/2db27d555441bee2dd31817acc8c92b7b718ee55)]:
  - @valbuild/ui@0.121.0
  - @valbuild/shared@0.121.0
  - @valbuild/server@0.121.0
  - @valbuild/core@0.121.0
  - @valbuild/react@0.121.0
  - @valbuild/language-server@0.121.0

## 0.120.4

### Patch Changes

- Updated dependencies [[`6df3cae`](https://github.com/valbuild/val/commit/6df3caec1cc043a07b532d3174583b8218d4871d)]:
  - @valbuild/ui@0.120.4
  - @valbuild/react@0.120.4
  - @valbuild/server@0.120.4
  - @valbuild/language-server@0.120.4

## 0.120.3

### Patch Changes

- Updated dependencies [[`9b96184`](https://github.com/valbuild/val/commit/9b96184cf6ad6d52a714867fb1527eeec6c776f4), [`1a2484a`](https://github.com/valbuild/val/commit/1a2484a309679bd5e963d626466c2828f74d49f8), [`71becc7`](https://github.com/valbuild/val/commit/71becc7e543432e4a57e36d54aaf803e9a447ffd)]:
  - @valbuild/ui@0.120.3
  - @valbuild/react@0.120.3
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

- [#590](https://github.com/valbuild/val/pull/590) [`6f318d4`](https://github.com/valbuild/val/commit/6f318d406295b772e721bf463283f47e2822e996) Thanks [@freekh](https://github.com/freekh)! - MCP: survive a signing-key rotation, and say what a refused local token means.

  `@valbuild/next` caches the authorization server's JWKS for five minutes. Until
  now a token signed with a key that arrived inside that window was refused
  outright, so every warm instance rejected valid tokens until the cache expired —
  a rotation on the issuer's side showed up as an outage on yours.

  A token naming a key the cache does not hold now provokes one refetch of the key
  set, at most once per issuer every 30 seconds. The rate limit matters because the
  key id comes from the token: without it, unknown key ids would be a way to make
  your app call its issuer once per request. It limits how often a fetch is
  _started_, so requests that arrive while one is already running join it — which
  is the normal shape of a rotation, where many requests meet the new key at once.

  Separately, an MCP call that presents an access token to a project running in
  local filesystem mode is still refused — there is nothing to authenticate against
  — but the message now names the cause, which is that the project has an `oauth`
  issuer configured (often `VAL_OAUTH_ISSUER` in a local `.env`) and should not
  have one for local development.

- Updated dependencies [[`6f318d4`](https://github.com/valbuild/val/commit/6f318d406295b772e721bf463283f47e2822e996)]:
  - @valbuild/server@0.120.1
  - @valbuild/language-server@0.120.1

## 0.120.0

### Minor Changes

- [#589](https://github.com/valbuild/val/pull/589) [`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a) Thanks [@freekh](https://github.com/freekh)! - **Breaking:** `s.richtext()` options are flat.

  The `style`, `block` and `inline` groups are gone — every option is a key of its
  own. The names are unchanged, so updating a schema is only a matter of removing
  the wrappers:

  ```ts
  // before
  s.richtext({
    style: { bold: true, italic: true },
    block: { h1: true, ul: true },
    inline: { a: true, img: s.image() },
  });

  // after
  s.richtext({
    bold: true,
    italic: true,
    h1: true,
    ul: true,
    a: true,
    img: s.image(),
  });
  ```

  The groups never carried any meaning the option names did not already have, and
  they cost something real: an option name and its `ValRichText` theme key were
  spelled differently (`block.h1` vs `theme.h1`), so the type that keeps a theme
  exhaustive had to restate all thirteen options by hand. It is now a mapped type
  over the options themselves — which also fixes an inconsistency in it: enabling
  links with a schema (`a: s.route()`) rather than `a: true` now requires an `a`
  key in the theme, the way `img` always has.

  `ValRichText` themes were already flat and are unchanged. The serialized schema
  that the server sends the Studio is flat too, so a project must not mix
  `@valbuild/*` versions across this release.

### Patch Changes

- Updated dependencies [[`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a)]:
  - @valbuild/core@0.120.0
  - @valbuild/react@0.120.0
  - @valbuild/shared@0.120.0
  - @valbuild/ui@0.120.0
  - @valbuild/language-server@0.120.0
  - @valbuild/server@0.120.0

## 0.119.0

### Patch Changes

- Updated dependencies [[`84165f7`](https://github.com/valbuild/val/commit/84165f743eb5802da1e8079bbe98eafcb2cdcec8)]:
  - @valbuild/ui@0.119.0
  - @valbuild/react@0.119.0
  - @valbuild/server@0.119.0
  - @valbuild/language-server@0.119.0

## 0.118.0

### Patch Changes

- Updated dependencies [[`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95), [`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95), [`fe6a398`](https://github.com/valbuild/val/commit/fe6a3981691394e6f34d4d80ec17febd356a98cc)]:
  - @valbuild/ui@0.118.0
  - @valbuild/server@0.118.0
  - @valbuild/shared@0.118.0
  - @valbuild/react@0.118.0
  - @valbuild/language-server@0.118.0

## 0.117.1

### Patch Changes

- Updated dependencies [[`0ae7bac`](https://github.com/valbuild/val/commit/0ae7bac8a186460bc2b31f2ded89b00027bafb55)]:
  - @valbuild/ui@0.117.1
  - @valbuild/react@0.117.1
  - @valbuild/server@0.117.1
  - @valbuild/language-server@0.117.1

## 0.117.0

### Minor Changes

- [#582](https://github.com/valbuild/val/pull/582) [`fca3efa`](https://github.com/valbuild/val/commit/fca3efa389e2817401f55ea3dd184af7c611b807) Thanks [@freekh](https://github.com/freekh)! - Accept OAuth access tokens on the MCP endpoint, so editors can authorize as themselves

  `initValMcp` takes an optional `oauth` config. Give it the authorization server's
  URL and this endpoint's own URL, and every MCP call must then present an access
  token that Val's authorization server issued:

  ```ts
  const { valMcpAuthorize, valMcpTools, valMcpMetadata } = initValMcp(
    valModules,
    config,
    {
      oauth: {
        issuer: "https://admin.val.build",
        resource: "https://your-app.com/api/mcp",
      },
    },
  );
  ```

  The token is verified in your app — signature against the issuer's published
  keys, plus issuer, audience and expiry — so the caller's identity is checked
  rather than claimed. **Patches created over MCP now carry that profile as their
  author**, which is what makes an edit made from a phone show up in the review
  screen as somebody's rather than nobody's. Scopes are enforced too: a token
  without `val:write` cannot reach a tool that writes.

  Mount the discovery document so clients can find where to authorize:

  ```ts
  // app/.well-known/oauth-protected-resource/route.ts
  import { valMcpMetadata } from "../../../val/mcp";
  export const { GET, OPTIONS } = valMcpMetadata!;
  ```

  `valMcpMetadata` is `null` when no `oauth` config is given.

  **Nothing changes if you leave `oauth` out.** Local development still works with
  no authorization server, and an app already using a personal access token keeps
  working as before.

  One breaking change if you built your own host on `createValTools`:
  `ValToolContext.auth` is now a tagged union, so `{ pat }` becomes
  `{ type: "pat", pat }`. The new variant is
  `{ type: "verified-profile", profileId, scopes }`, for a host that verified a
  token itself.

### Patch Changes

- [#579](https://github.com/valbuild/val/pull/579) [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d) Thanks [@freekh](https://github.com/freekh)! - Every release now ships a changelog. Each package's `CHANGELOG.md` records what
  changed under the version that shipped it — with a link to the pull request, the
  commit and the author — and the same entry becomes the body of the GitHub
  Release for the tag. The file is included in the npm tarball, so it is also
  readable from an installed copy.

  Up to now those changelogs were generated empty, and the GitHub Releases with
  them, so there was no record of what any given version contained. Releases from
  this one on have one; earlier versions stay blank.

- Updated dependencies [[`fca3efa`](https://github.com/valbuild/val/commit/fca3efa389e2817401f55ea3dd184af7c611b807), [`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f), [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d)]:
  - @valbuild/server@0.117.0
  - @valbuild/language-server@0.117.0
  - @valbuild/core@0.117.0
  - @valbuild/react@0.117.0
  - @valbuild/shared@0.117.0
  - @valbuild/ui@0.117.0

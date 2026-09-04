# @valbuild/next

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

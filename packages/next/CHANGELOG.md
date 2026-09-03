# @valbuild/next

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

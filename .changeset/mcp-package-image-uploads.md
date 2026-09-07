---
"@valbuild/mcp": minor
"@valbuild/next": minor
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/create": minor
---

Val's MCP endpoint moves to its own package, and can now upload images

Everything that serves Val's content tools over MCP — the tool registry, the
write path behind it, the request guards and the access-token verification —
now lives in **`@valbuild/mcp`** instead of being split between
`@valbuild/server` and `@valbuild/next`.

**Nothing changes for an app that already mounts it.** `initValMcp` is still
exported from `@valbuild/next/server` and behaves exactly as before; it is now a
ten-line binding over `@valbuild/mcp`, supplying the Next version that
`initHandlerOptions` asks for. A host that is not Next can call
`initValMcp` from `@valbuild/mcp` directly.

If you built your own host on `createValTools`, import it from `@valbuild/mcp`
rather than `@valbuild/server`; the tool types moved with it.

## Image uploads

An agent can now add an image, with a new `upload_image` tool. It takes a path
to a file on the machine your app runs on, or the image inline as base64, and
puts it in an `s.image()` field or an `s.images()` gallery.

Uploads are converted **only where the Studio would convert them**: `encode` is
off unless the schema asks for it (`s.image({ encode: { type: "webp" } })`), and
when it does, which images are converted, how far they are scaled and when the
original wins are the same decisions the browser makes — the same code, now
shared. An upload to a schema without `encode` is stored exactly as it arrived,
whatever its size.

One thing the tool does that the Studio does not: it refuses an image the
schema's `accept` does not cover, checked on the bytes that would actually be
stored. The Studio does not need to — its file picker carries `accept` — and
validation reports a mismatch as server-repairable, so nothing downstream would
stop it. An agent has no picker. Note the ordering:
`s.image({ accept: "image/webp", encode: { type: "webp" } })` still takes a PNG,
because the conversion happens first and it is the result that is checked.

It is the one tool you construct yourself, because it needs an image library
and `sharp` ships a compiled binary per platform. Val does not put one in every
project that installs it, so you decide:

```sh
npm install sharp
```

```ts
import sharp from "sharp";
import { createValImageTools } from "@valbuild/mcp";
import { sharpImageProcessor } from "@valbuild/mcp/sharp";

const { valMcpAuthorize, valMcpTools } = initValMcp(valModules, config, {
  extraTools: createValImageTools(sharpImageProcessor(sharp)),
});
```

Leave `extraTools` out and everything else works as before — the agent can read,
validate and edit content, it just cannot add an image. `sharp` is passed in
rather than imported, so you can supply another encoder: `ValImageProcessor` is
two functions, `read` and `encode`.

Remotely stored images work too — `s.image().remote()` and
`s.images({ remote: true })` — and they need nothing extra from the MCP client.
Adding one does not upload anything to Val's content host: the bytes go into the
patch store like any other unpublished change, and the push to
`remote.val.build` happens when you publish, exactly as it does for an image
added through the Studio. All the tool has to do first is ask the project which
bucket to name in the ref, and the credential for that is the one your app
already has — its API key when it has one, and in local development the
`val login` token in your project, the same one `val validate --fix` uses. If
you have not logged in, it says so and writes nothing.

## `npm create @valbuild` asks

The starter template now ships the MCP endpoint, and `npm create @valbuild`
asks whether you want it — and, if you do, whether agents should be able to
upload images, saying that this adds `sharp`. Both default to yes, and both can
be answered up front for a scripted setup:

```sh
pnpm create @valbuild my-app --mcp --no-image-uploads
```

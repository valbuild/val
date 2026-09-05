# Val MCP

Val's content tools, and the checks that decide whether a request may reach
them, for hosts that speak the Model Context Protocol.

Nothing in this package imports an MCP SDK. The app owns the transport — which
SDK, which route, which framework — and this owns the parts that must not be
re-decided per app: the tools themselves, whether a request is allowed to reach
them at all, and whose credential it carries.

```ts
import { initValMcp } from "@valbuild/mcp";

const { valMcpAuthorize, valMcpTools, valMcpMetadata } = initValMcp(
  valModules,
  config,
);
```

## Image uploads need `sharp`

The tool that uploads an image is not part of the default set, because reading
the dimensions out of a JPEG and re-encoding it to WebP needs an image library,
and `sharp` is a native dependency no project should acquire without asking for
it. Install it yourself and pass it in:

```sh
npm install sharp
```

```ts
import sharp from "sharp";
import { initValMcp, createValImageTools } from "@valbuild/mcp";
import { sharpImageProcessor } from "@valbuild/mcp/sharp";

const { valMcpAuthorize, valMcpTools } = initValMcp(valModules, config, {
  extraTools: createValImageTools(sharpImageProcessor(sharp)),
});
```

Leave `extraTools` out and everything else still works — an agent can then read,
validate and edit content, but not add an image.

See `docs/plans/mcp.md` in the repository for the design.

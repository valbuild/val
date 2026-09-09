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

## The tools

Reading:

| Tool                         |                                                           |
| ---------------------------- | --------------------------------------------------------- |
| `get_all_schema`             | every module's path and schema — where to start           |
| `search_content`             | find content by text, several queries at once             |
| `get_source`                 | the content at a source path, unpublished changes applied |
| `get_record_keys`            | a record's keys without its values                        |
| `count_entries`              | how big something is before asking for it                 |
| `get_source_path_from_route` | the module behind a URL                                   |
| `get_patches`                | what is edited but not yet published                      |
| `validate_content`           | what the Studio would show as an error                    |

Writing:

| Tool                         |                                                     |
| ---------------------------- | --------------------------------------------------- |
| `create_patch`               | change a value at a path                            |
| `duplicate_source`           | copy an array item or record entry                  |
| `empty_at_path`              | build an empty value the schema accepts, to fill in |
| `remove_image_gallery_entry` | drop an image from an `s.images()` gallery          |
| `upload_image`               | add one — see below                                 |

Every write is validated against the schema before it is stored, and refused
rather than saved broken. A patch lands unpublished, exactly where the Studio
puts an edit, so a human still reviews and publishes it.

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

Remotely stored images (`s.images({ remote: true })`) work through the same tool.
Adding one uploads nothing to Val's content host — the bytes go into the patch
store, and the push happens at publish — so the only thing it needs is the
project's bucket list, read with your app's own credential (its API key, or the
`val login` token in your project during local development).

The design notes are in [`docs/plans/mcp.md`](https://github.com/valbuild/val/blob/main/docs/plans/mcp.md).

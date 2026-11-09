---
"@valbuild/ui": minor
"@valbuild/shared": minor
---

The Sketchpad covers several pages, builds what it shows, and can be linked to the content.

- **Route dividers.** A sketchpad is no longer about one page. A `--- /about` line starts the part about a page, so one sketch can cover a page and the pages it links to. Press a route to see that page beside the sketch, in the Studio's own live preview, which follows edits as they are made. A divider's menu changes its page, or adds a new one from a page type the site has (`/blog/[slug]`). A route the site has no page type for is allowed too, and is marked as needing code.
- **Start from a page.** An empty sketchpad offers to start from a page. The assistant writes that page into it, images and all, and changes nothing.
- **Build.** The button that sent the sketchpad to the assistant is now **Build**. It sends the sketchpad as a card in the chat (press it to open the sketchpad), with a request to change the pages to match the sketch. It is disabled while the sketch is empty.
- **Images that exist.** A box shows an image from a gallery, from the site's content, or one uploaded to the chat, and the picker offers exactly those, with search and Upload (which puts the file in the chat first). A box naming any other image says so. When the assistant writes a sketch with an image that is not in the project, the write is refused. Images are named by their content path (`/public/val/hero.webp`) and shown where the site serves them, including uploads that are not published yet.
- **Block types.** A box's kind is a combobox of the kinds of section the site's pages have, read from the schema. Any other word is allowed, and is marked as a new type that needs code.
- **Drag.** Blocks, rows, columns and images can be dragged to a new place. Columns share a row equally, so the width controls are gone.
- **Highlights.** The assistant can point at blocks, in a colour and with a note (for example, the ones that need code), with `highlight_sketchpad_blocks`. The highlights can be cleared, by the person or by the assistant.
- **Linked text (a try-out).** A heading or paragraph can be linked to a plain text field with `{field: <source path>}`. Typing in it then changes that field, as typing in the field would. The block shows what it is linked to and has an **Unlink** button. When the field was changed elsewhere, the block says so and offers the field's text. A sketchpad the assistant starts from a page links its text this way.
- **Converting images.** The assistant can convert an image in the chat to WebP, or scale it down, with `convert_session_image`, using the same encoder as the Studio's uploads.

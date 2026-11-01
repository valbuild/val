---
"@valbuild/ui": patch
---

**The design tab's assistant edits files instead of rewriting them.** A new `edit_file` tool replaces text the assistant names with new text, and stages the result the way `write_files` does. Before, every code change made the assistant write out the whole file, and that text stayed in the conversation, so even a one-line change cost the whole file in tokens. The text to replace must appear exactly once in the file, so the assistant can't edit the wrong place. `write_files` stays for new files, deletions and rewriting most of a file.

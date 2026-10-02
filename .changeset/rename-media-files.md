---
"@valbuild/ui": patch
"@valbuild/core": patch
---

Files and images can now be renamed in the Studio, for local files and remote ones.

- **Rename a file in a gallery** from its properties: click the pencil next to the file name. Every field that uses the file is updated to the new name in the same step, including images inside rich text, and the dialog says how many places will change before you save.
- **Rename the file of an image or file field** with the new **Rename** button. A field that picks its file from a gallery sends you to the gallery instead, because other fields may use the same file.
- **You choose the name, Val keeps the rest.** The short hash at the end of the name (`_a1b2c`) and the file extension stay as they are, so two different files can never end up with the same name. The name is cleaned up the same way an upload's is: lower case, and characters that do not belong in a URL are dropped.
- **Renaming a local file moves it.** The file is saved under the new name and the old file is deleted when you publish, so nothing is left behind to clean up. If another field uses the same file without going through a gallery, pick the file again in that field.
- **Renaming a remote file is instant.** Remote files are stored by their content, so a published remote file only gets a new address and nothing is uploaded again.
- **Gallery images used in rich text now count as references.** A gallery file used only inside rich text could be deleted, which left the text pointing at nothing. It is now listed under the file's references and blocks the delete like any other use.

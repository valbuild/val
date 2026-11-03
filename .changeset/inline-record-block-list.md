---
"@valbuild/ui": patch
---

Inline lists are easier to work with, and inline records now work the same way as inline arrays.

**Inline records** (`s.record(...).render({ as: "inline" })`) are drawn as the same rows as inline arrays, named by their key instead of numbered. Click the key for **Rename**, **Duplicate** and **Delete**. **Add** asks for the new key. A record has no order, so its rows have no drag handle.

**Every row of an inline array:**

- **Row menu:** click the row's number for **Add above**, **Add below**, **Duplicate**, **Move** and **Delete**.
- **Move:** the submenu has **Move up**, **Move down**, **Move to start**, **Move to end** and **Move to position…**. That last one takes a number. A number outside the list is first changed to the nearest valid position, with a note saying so. Press Move again to move.
- **Drag:** drag the handle to the left of a row to move it.
- **Insert between rows:** hover the gap between two rows and click the **+** that appears.
- **Collapse:** click a row's header to collapse it. Its title stays visible, and a union row also shows which variant it is.

**Keyboard and screen reader:** everything above works without a mouse.

- Press Enter on a row's number to open its menu. Use the arrow keys to move through it, Right to open the Move submenu and Escape to close.
- From a row's handle, press Space or Enter to pick the row up, then the arrow keys to move it.
- Press Tab from a handle to reach the insert point above that row.
- After an insert or a move, focus goes to the new or moved item.

**The same look as the rest of the Studio:**

- Labels, descriptions and text sizes inside a row now match the normal field view.
- A field's `.describe(...)` text is now shown under its label.
- A nested list's label row is laid out like any field's header, with its **+** and collapse button on the right.
- An inline `keyOf` shows the entry it points to in the same layout as the row around it.
- A read-only list shows no drag handles and no **+** buttons.

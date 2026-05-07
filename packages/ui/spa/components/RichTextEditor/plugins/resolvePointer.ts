import type { Node as PMNode } from "prosemirror-model";

export function resolvePointerToPos(
  pointer: string,
  doc: PMNode,
): { from: number; to: number } | null {
  const segments = pointer
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = parseInt(s, 10);
      return isNaN(n) ? s : n;
    });

  if (segments.length === 0) return null;

  let currentNode: PMNode = doc;
  let offset = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (typeof seg === "number") {
      let childIndex = 0;
      let found = false;
      currentNode.forEach((child, childOffset) => {
        if (found) return;
        if (childIndex === seg) {
          if (i === segments.length - 1) {
            offset += childOffset;
            currentNode = child;
          } else {
            offset += childOffset + 1;
            currentNode = child;
          }
          found = true;
        }
        childIndex++;
      });
      if (!found) return null;
    } else if (seg === "children") {
      continue;
    } else {
      return null;
    }
  }

  const from = offset;
  const to = from + currentNode.nodeSize;
  return { from: Math.max(0, from), to: Math.min(doc.content.size, to) };
}

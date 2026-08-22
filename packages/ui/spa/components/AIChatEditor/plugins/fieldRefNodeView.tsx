import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditorView, NodeView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { Internal, type SourcePath } from "@valbuild/core";
import { prettifyFilename } from "../../../utils/prettifyFilename";

function FieldRefChip({
  path,
  onRemove,
}: {
  path: SourcePath;
  onRemove: () => void;
}) {
  let label = path;
  try {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    const moduleParts = Internal.splitModuleFilePath(moduleFilePath);
    const modulePathParts = Internal.splitModulePath(modulePath);
    const moduleSuffix =
      moduleParts.length > 0
        ? prettifyFilename(moduleParts[moduleParts.length - 1])
        : moduleFilePath;
    const allParts = [moduleSuffix, ...modulePathParts.map(prettifyFilename)];
    label = allParts.join(" / ") as SourcePath;
  } catch {
    // fall through to raw path
  }
  return createElement(
    "span",
    {
      className:
        "inline-flex items-center gap-1 align-baseline rounded bg-bg-secondary text-fg-primary px-1.5 py-0.5 text-xs font-mono mx-0.5",
      title: path,
      contentEditable: false,
    },
    createElement("span", { className: "truncate max-w-[16em]" }, label),
    createElement(
      "button",
      {
        type: "button",
        onMouseDown: (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        },
        className: "text-fg-secondary hover:text-fg-primary leading-none",
        "aria-label": "Remove field reference",
      },
      "×",
    ),
  );
}

export function createFieldRefNodeView() {
  return function fieldRefNodeView(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
  ): NodeView {
    const dom = document.createElement("span");
    dom.setAttribute("data-val-field-ref", node.attrs.path as string);
    dom.style.display = "inline-block";
    dom.style.verticalAlign = "baseline";
    dom.contentEditable = "false";

    const root: Root = createRoot(dom);

    const removeSelf = () => {
      const pos = getPos();
      if (pos === undefined) return;
      const tr = view.state.tr.delete(pos, pos + node.nodeSize);
      view.dispatch(tr);
      view.focus();
    };

    root.render(
      createElement(FieldRefChip, {
        path: node.attrs.path as SourcePath,
        onRemove: removeSelf,
      }),
    );

    return {
      dom,
      update(updated) {
        if (updated.type !== node.type) return false;
        if (updated.attrs.path === node.attrs.path) return true;
        root.render(
          createElement(FieldRefChip, {
            path: updated.attrs.path as SourcePath,
            onRemove: removeSelf,
          }),
        );
        return true;
      },
      stopEvent(e) {
        // Allow clicks on our × button without ProseMirror swallowing them.
        return (e as Event).type === "mousedown";
      },
      ignoreMutation() {
        return true;
      },
      destroy() {
        queueMicrotask(() => root.unmount());
      },
    };
  };
}

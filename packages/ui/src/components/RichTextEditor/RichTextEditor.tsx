/* eslint-disable @typescript-eslint/no-explicit-any */
import { $getRoot, LexicalEditor } from "lexical";
import { ListItemNode, ListNode } from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { FC } from "react";
import LexicalContentEditable from "./ContentEditable";
import { ImageNode } from "./Nodes/ImageNode";
import { AutoFocus } from "./Plugins/AutoFocus";
import ImagesPlugin from "./Plugins/ImagePlugin";
import Toolbar from "./Plugins/Toolbar";
import { RichText } from "@valbuild/core";
import { HeadingNode } from "@lexical/rich-text";
import { toLexicalNode } from "./conversion.test";

export interface RichTextEditorProps {
  richtext: RichText;
  onEditor?: (editor: LexicalEditor) => void; // Not the ideal way of passing the editor to the upper context, we need it to be able to save
}

function onError(error: any) {
  console.error(error);
}

export const RichTextEditor: FC<RichTextEditorProps> = ({
  richtext,
  onEditor,
}) => {
  const prePopulatedState = () => {
    const root = $getRoot();
    $getRoot().append(
      ...richtext.children.map((child) => toLexicalNode(child))
    );
    root.selectEnd();
  };
  const initialConfig = {
    namespace: "val",
    editorState: prePopulatedState,
    nodes: [HeadingNode, ImageNode, ListNode, ListItemNode],
    theme: {
      root: "relative p-4 bg-base min-h-[200px] text-white font-roboto",
      text: {
        bold: "font-semibold",
        underline: "underline",
        italic: "italic",
        strikethrough: "line-through",
        underlineStrikethrough: "underline line-through",
      },
      list: {
        listitem: "ml-[20px]",
        ol: "list-decimal",
        ul: "list-disc",
      },
      heading: {
        h1: "text-4xl font-bold",
        h2: "text-3xl font-bold",
        h3: "text-2xl font-bold",
        h4: "text-xl font-bold",
        h5: "text-lg font-bold",
        h6: "text-base font-bold",
      },
    },
    onError,
  };
  return (
    <div className="relative bg-base min-h-[200px] mt-2 border border-highlight overflow-none resize">
      <LexicalComposer initialConfig={initialConfig}>
        <Toolbar onEditor={onEditor} />
        <ImagesPlugin />
        <RichTextPlugin
          contentEditable={
            <LexicalContentEditable className="w-full h-full overflow-auto outline-none text-primary" />
          }
          placeholder={
            <div className="absolute top-[calc(58px+1rem)] left-4 text-base/25 text-primary">
              Enter some text...
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ListPlugin />
        <AutoFocus />
        <HistoryPlugin />
      </LexicalComposer>
    </div>
  );
};

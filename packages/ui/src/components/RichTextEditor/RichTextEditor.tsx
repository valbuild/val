/* eslint-disable @typescript-eslint/no-explicit-any */
import { LexicalEditor } from "lexical";
import { ListItemNode, ListNode } from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { FC } from "react";
import LexicalContentEditable from "./ContentEditable";
import { ImageNode } from "./Nodes/ImageNode";
import { AutoFocus } from "./Plugins/AutoFocus";
import ImagesPlugin from "./Plugins/ImagePlugin";
import Toolbar from "./Plugins/Toolbar";
import { AnyRichTextOptions, RichTextSource } from "@valbuild/core";
import { HeadingNode } from "@lexical/rich-text";
import { richTextSourceToLexical } from "@valbuild/shared/internal";
import { parseRichTextSource } from "@valbuild/shared/internal";
import { useValOverlayContext } from "../ValOverlayContext";
import { LinkNode } from "@lexical/link";
import LinkEditorPlugin from "./Plugins/LinkEditorPlugin";

export interface RichTextEditorProps {
  richtext: RichTextSource<AnyRichTextOptions>;
  onEditor?: (editor: LexicalEditor) => void; // Not the ideal way of passing the editor to the upper context, we need it to be able to save
}

function onError(error: any) {
  console.error(error);
}

const TOOLBAR_HEIGHT = 28;

export const RichTextEditor: FC<RichTextEditorProps> = ({
  richtext,
  onEditor,
}) => {
  const { windowSize } = useValOverlayContext();
  const prePopulatedState = (editor: LexicalEditor) => {
    editor.setEditorState(
      editor.parseEditorState({
        root: richTextSourceToLexical(parseRichTextSource(richtext)),
      })
    );
  };
  const initialConfig = {
    namespace: "val",
    editorState: prePopulatedState,
    nodes: [HeadingNode, ImageNode, ListNode, ListItemNode, LinkNode],
    theme: {
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
        h6: "text-md font-bold",
      },
      link: "text-highlight underline",
    },
    onError,
  };
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <AutoFocus />
      <Toolbar onEditor={onEditor} />
      <RichTextPlugin
        contentEditable={
          <div
            className="font-sans border-b text-primary border-highlight"
            style={{
              minHeight: windowSize?.innerHeight
                ? windowSize?.innerHeight - TOOLBAR_HEIGHT
                : undefined,
            }}
          >
            <LexicalContentEditable className="p-4 outline-none bg-fill" />
          </div>
        }
        placeholder={<div className="">Enter some text...</div>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <LinkPlugin />
      <LinkEditorPlugin />
      <ListPlugin />
      <ImagesPlugin />
      <HistoryPlugin />
    </LexicalComposer>
  );
};

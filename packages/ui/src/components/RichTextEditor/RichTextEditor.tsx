"use client";

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
import { richTextSourceToLexical } from "../../richtext/conversion/richTextSourceToLexical";
import { useValOverlayContext } from "../ValOverlayContext";
import { parseRichTextSource } from "../../exports";
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
        bold: "val-font-semibold",
        underline: "val-underline",
        italic: "val-italic",
        strikethrough: "val-line-through",
        underlineStrikethrough: "val-underline lval-ine-through",
      },
      list: {
        listitem: "val-ml-[20px]",
        ol: "val-list-decimal",
        ul: "val-list-disc",
      },
      heading: {
        h1: "val-text-4xl val-font-bold",
        h2: "val-text-3xl val-font-bold",
        h3: "val-text-2xl val-font-bold",
        h4: "val-text-xl val-font-bold",
        h5: "val-text-lg val-font-bold",
        h6: "val-text-md val-font-bold",
      },
      link: "val-text-highlight val-underline",
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
            className="val-text-primary val-border-b val-border-highlight val-font-roboto"
            style={{
              minHeight: windowSize?.innerHeight
                ? windowSize?.innerHeight - TOOLBAR_HEIGHT
                : undefined,
            }}
          >
            <LexicalContentEditable className="val-p-4 val-outline-none val-bg-fill" />
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

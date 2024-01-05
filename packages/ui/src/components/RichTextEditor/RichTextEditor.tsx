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
import { ImageNode } from "./nodes/ImageNode";
import { AutoFocus } from "./plugins/AutoFocus";
import ImagesPlugin from "./plugins/ImagePlugin";
import Toolbar from "./plugins/Toolbar";
import { AnyRichTextOptions, RichTextSource } from "@valbuild/core";
import { HeadingNode } from "@lexical/rich-text";
import { richTextSourceToLexical } from "@valbuild/shared/internal";
import { parseRichTextSource } from "@valbuild/shared/internal";
import { LinkNode } from "@lexical/link";
import LinkEditorPlugin from "./plugins/LinkEditorPlugin";

export interface RichTextEditorProps {
  richtext: RichTextSource<AnyRichTextOptions>;
  onEditor?: (editor: LexicalEditor) => void; // Not the ideal way of passing the editor to the upper context, we need it to be able to save
}

function onError(error: any) {
  console.error(error);
}

export const RichTextEditor: FC<RichTextEditorProps> = ({
  richtext,
  onEditor,
}) => {
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
          <div className="px-3 py-2 text-sm border-b rounded-md rounded-t-none border-x border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            <LexicalContentEditable className="p-4 outline-none bg-fill" />
          </div>
        }
        placeholder={<p className="text-sm">Enter text</p>}
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

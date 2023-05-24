import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  SerializedEditorState,
  SerializedLexicalNode,
} from "lexical";

import { ListItemNode, ListNode } from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { HeadingNode } from "@lexical/rich-text";
import { FC } from "react";
import LexicalContentEditable from "./ContentEditable";
import { ImageNode } from "./Nodes/ImageNode";
import { AutoFocus } from "./Plugins/AutoFocus";
import ImagesPlugin from "./Plugins/ImagePlugin";
import Toolbar from "./Plugins/Toolbar";

export interface RichTextEditorProps {
  entries: {
    source: string;
    status: "ready";
    moduleId: string;
    locale: "en_US";
    value: string;
    path: string;
  }[];
  setNodes: React.Dispatch<
    React.SetStateAction<SerializedEditorState<SerializedLexicalNode> | null>
  >;
}

function onError(error: any) {
  console.error(error);
}

export const RichTextEditor: FC<RichTextEditorProps> = ({
  entries,
  setNodes,
}) => {
  const prePopulatedState = () => {
    const root = $getRoot();
    const paragraph = $createParagraphNode();
    const text = $createTextNode(entries[0].value);
    paragraph.append(text);
    $getRoot().append(paragraph);
    root.selectEnd();
  };
  const initialConfig = {
    namespace: "VAL",
    editorState: prePopulatedState,
    nodes: [HeadingNode, ImageNode, ListNode, ListItemNode],
    theme: {
      root: "relative p-4 bg-valMediumBlack w-full h-full min-h-[200px] text-white font-roboto",
      text: {
        bold: "font-semibold",
        underline: "underline",
        italic: "italic",
        strikethrough: "line-through",
        underlineStrikethrough: "underlined-line-through",
      },
      list:{
        listitem: "ml-[20px]",
        ol: 'list-decimal',
        ul: 'list-disc'
      },
      heading:{
        h1: "text-4xl font-bold",
        h2: "text-3xl font-bold",
        h3: "text-2xl font-bold",
        h4: "text-xl font-bold",
        h5: "text-lg font-bold",
        h6: "text-base font-bold",
      }
    },
    onError,
  };
  return (
    <div className=" relative bg-valMediumBlack min-h-[200px] mt-2 border border-valDarkGrey rounded h-full  w-fit ">
      <LexicalComposer initialConfig={initialConfig}>
        <Toolbar setNodes={setNodes} />
        <ImagesPlugin />
        <RichTextPlugin
          contentEditable={
            <LexicalContentEditable className="relative flex flex-col h-full w-full min-h-[200px]" />
          }
          placeholder={
            <div className="absolute top-[calc(58px+1rem)] left-4 text-valLightGrey/25 ">
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

import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  LexicalEditor,
  LexicalNode,
  SerializedEditorState,
  SerializedLexicalNode,
} from "lexical";
import {
  ListItemNode,
  ListNode,
  $createListNode,
  $createListItemNode,
} from "@lexical/list";
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
import {
  RichText,
  TextNode as ValTextNode,
  HeadingNode as ValHeadingNode,
  ListItemNode as ValListItemNode,
  ParagraphNode as ValParagraphNode,
  ListNode as ValListNode,
} from "@valbuild/lib";
import { $createHeadingNode, HeadingNode } from "@lexical/rich-text";

export interface RichTextEditorProps {
  richtext: RichText;
  onEditor?: (editor: LexicalEditor) => void; // Not the ideal way of passing the editor to the upper context, we need it to be able to save
}

function onError(error: any) {
  console.error(error);
}

type ValNode =
  | ValTextNode
  | ValHeadingNode
  | ValListItemNode
  | ValParagraphNode
  | ValListNode;
function toLexicalNode(node: ValNode): LexicalNode {
  switch (node.type) {
    case "heading":
      return toLexicalHeadingNode(node);
    case "listitem":
      return toLexicalListItemNode(node);
    case "paragraph":
      return toLexicalParagraphNode(node);
    case "list":
      return toLexicalListNode(node);
    case "text":
      return toLexicalTextNode(node);
  }
}

function toLexicalHeadingNode(heading: ValHeadingNode): LexicalNode {
  const node = $createHeadingNode(heading.tag);
  node.setFormat(heading.format);
  node.setIndent(heading.indent);
  node.setDirection(heading.direction);
  node.append(...heading.children.map((child) => toLexicalNode(child)));
  return node;
}

function toLexicalParagraphNode(paragraph: ValParagraphNode): LexicalNode {
  const node = $createParagraphNode();
  node.setFormat(paragraph.format);
  node.setIndent(paragraph.indent);
  node.setDirection(paragraph.direction);
  node.append(...paragraph.children.map((child) => toLexicalNode(child)));
  return node;
}

function toLexicalListItemNode(listItem: ValListItemNode): LexicalNode {
  const node = $createListItemNode();
  node.setFormat(listItem.format);
  node.setIndent(listItem.indent);
  node.setDirection(listItem.direction);
  node.setValue(listItem.value);
  node.setChecked(listItem.checked);
  node.append(...listItem.children.map((child) => toLexicalNode(child)));
  return node;
}

function toLexicalListNode(list: ValListNode): LexicalNode {
  const node = $createListNode(list.listType, list.start);
  node.setFormat(list.format);
  node.setIndent(list.indent);
  node.setDirection(list.direction);
  node.append(...list.children.map((child) => toLexicalNode(child)));
  return node;
}

function toLexicalTextNode(text: ValTextNode): LexicalNode {
  const node = $createTextNode(text.text);
  node.setFormat(text.format as any); // TODO: why is text.format numbers when we are trying it out?
  text.indent && node.setIndent(text.indent);
  text.direction && node.setDirection(text.direction);
  node.setStyle(text.style);
  node.setDetail(text.detail);
  return node;
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
      root: "relative p-4 bg-base w-full h-full min-h-[200px] text-white font-roboto",
      text: {
        bold: "font-semibold",
        underline: "underline",
        italic: "italic",
        strikethrough: "line-through",
        underlineStrikethrough: "underlined-line-through",
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
    <div className=" relative bg-base min-h-[200px] mt-2 border border-border rounded h-full  w-fit ">
      <LexicalComposer initialConfig={initialConfig}>
        <Toolbar onEditor={onEditor} />
        <ImagesPlugin />
        <RichTextPlugin
          contentEditable={
            <LexicalContentEditable className="relative flex flex-col h-full w-full min-h-[200px]" />
          }
          placeholder={
            <div className="absolute top-[calc(58px+1rem)] left-4 text-base/25 ">
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

import {
  HeadingNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  RichText,
  TextNode,
  Val,
} from "@valbuild/lib";
import { createElement } from "react";

export function ValRichText({ children }: { children: Val<RichText> }) {
  return (
    <div>
      {children.val.children.map((child, i) => {
        switch (child.type) {
          case "heading":
            return <HeadingNodeComponent key={i} node={child} />;
          case "paragraph":
            return <ParagraphNodeComponent key={i} node={child} />;
          case "list":
            return <ListNodeComponent key={i} node={child} />;
          default:
            throw Error("Unknown node type: " + (child as any)?.type);
        }
      })}
    </div>
  );
}

function TextNodeComponent({ node }: { node: TextNode }) {
  return <span>{node.text}</span>;
}

function HeadingNodeComponent({ node }: { node: HeadingNode }) {
  return createElement(
    node.tag,
    {},
    node.children.map((child, i) => <TextNodeComponent key={i} node={child} />)
  );
}

function ParagraphNodeComponent({ node }: { node: ParagraphNode }) {
  return (
    <p>
      {node.children.map((child, i) => {
        switch (child.type) {
          case "text":
            return <TextNodeComponent key={i} node={child} />;
          default:
            throw Error("Unknown node type: " + (child as any)?.type);
        }
      })}
    </p>
  );
}

function ListNodeComponent({ node }: { node: ListNode }) {
  return createElement(
    node.tag,
    {},
    node.children.map((child, i) => <ListItemComponent key={i} node={child} />)
  );
}

function ListItemComponent({ node }: { node: ListItemNode }) {
  return (
    <li>
      {node.children.map((child, i) => {
        switch (child.type) {
          case "text":
            return <TextNodeComponent key={i} node={child} />;
          default:
            throw Error("Unknown node type: " + (child as any)?.type);
        }
      })}
    </li>
  );
}

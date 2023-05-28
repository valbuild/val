import {
  HeadingNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  RichText,
  TextNode,
  Val,
} from "@valbuild/lib";
import { Internal } from "@valbuild/lib";
import { createElement } from "react";
import parse from "style-to-object";

const getValPath = Internal.getValPath;
export function ValRichText({ children }: { children: Val<RichText> }) {
  return (
    <div data-val-path={getValPath(children)}>
      {children.children.map((child) => {
        switch (child.type.val) {
          case "heading":
            return (
              <HeadingNodeComponent
                key={getValPath(child)}
                node={child as Val<HeadingNode>}
              />
            );
          case "paragraph":
            return (
              <ParagraphNodeComponent
                key={getValPath(child)}
                node={child as Val<ParagraphNode>}
              />
            );
          case "list":
            return (
              <ListNodeComponent
                key={getValPath(child)}
                node={child as Val<ListNode>}
              />
            );
          default:
            throw Error("Unknown node type: " + (child as any)?.type);
        }
      })}
    </div>
  );
}

function TextNodeComponent({ node }: { node: Val<TextNode> }) {
  const actualVal = node.val;
  const styleProps = actualVal.style ? parse(actualVal.style) ?? {} : {};
  // TODO: Ugly! We should do this before serializing instead
  if (styleProps["font-family"]) {
    styleProps["fontFamily"] = styleProps["font-family"];
    delete styleProps["font-family"];
  }
  if (styleProps["font-size"]) {
    styleProps["fontSize"] = styleProps["font-size"];
    delete styleProps["font-size"];
  }
  const bitmask = actualVal.format.toString(2);
  const bitmaskOffset = bitmask.length - 1;
  function isBitOne(bit: number) {
    return (
      bitmask.length >= bitmaskOffset - bit &&
      bitmask[bitmaskOffset - bit] === "1"
    );
  }
  if (isBitOne(0)) {
    styleProps["fontWeight"] = "bold";
  }
  if (isBitOne(1)) {
    styleProps["fontStyle"] = "italic";
  }
  if (isBitOne(2)) {
    if (!styleProps["textDecoration"]) {
      styleProps["textDecoration"] = "line-through";
    } else {
      styleProps["textDecoration"] += " line-through";
    }
  }
  if (isBitOne(3)) {
    if (!styleProps["textDecoration"]) {
      styleProps["textDecoration"] = "underline";
    } else {
      styleProps["textDecoration"] += " underline";
    }
  }
  return <span style={styleProps}>{actualVal.text}</span>;
}

function HeadingNodeComponent({ node }: { node: Val<HeadingNode> }) {
  return createElement(
    node.tag.val,
    {},
    node.children.map((child) => (
      <TextNodeComponent key={getValPath(child)} node={child} />
    ))
  );
}

function ParagraphNodeComponent({ node }: { node: Val<ParagraphNode> }) {
  return (
    <p>
      {node.children.map((child) => {
        switch (child.type.val) {
          case "text":
            return <TextNodeComponent key={getValPath(child)} node={child} />;
          default:
            throw Error("Unknown node type: " + (child as any)?.type);
        }
      })}
    </p>
  );
}

function ListNodeComponent({ node }: { node: Val<ListNode> }) {
  return createElement(
    node.val.tag,
    {},
    node.children.map((child) => (
      <ListItemComponent key={getValPath(child)} node={child} />
    ))
  );
}

function ListItemComponent({ node }: { node: Val<ListItemNode> }) {
  return (
    <li>
      {node.children.map((child, i) => {
        switch (child.val.type) {
          case "text":
            return <TextNodeComponent key={i} node={child} />;
          default:
            throw Error("Unknown node type: " + (child as any)?.type);
        }
      })}
    </li>
  );
}

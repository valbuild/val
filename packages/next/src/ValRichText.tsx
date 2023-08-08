/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  HeadingNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  RichText,
  SourcePath,
  TextNode,
} from "@valbuild/core";
import { createElement } from "react";
import parse from "style-to-object";

export function ValRichText({ children }: { children: RichText }) {
  const root: RichText = children;
  const path = root.valPath;
  return (
    <div data-val-path={path}>
      {root.children.map((child, i) => {
        const childType = child.type;
        const childPath = `${path}.${i}` as SourcePath;
        console.log(`'${childType}', ${childPath}`);
        switch (childType) {
          case "heading":
            return (
              <HeadingNodeComponent
                key={childPath}
                path={childPath}
                node={child}
              />
            );
          case "paragraph":
            return (
              <ParagraphNodeComponent
                key={childPath}
                path={childPath}
                node={child}
              />
            );
          case "list":
            return (
              <ListNodeComponent
                key={childPath}
                path={childPath}
                node={child}
              />
            );
          default:
            throw Error("Unknown root node type: " + childType);
        }
      })}
    </div>
  );
}

function TextNodeComponent({ node }: { node: TextNode }) {
  const styleProps = node.style ? parse(node.style) ?? {} : {};
  // TODO: Ugly! We should do this before serializing instead
  if (styleProps["font-family"]) {
    styleProps["fontFamily"] = styleProps["font-family"];
    delete styleProps["font-family"];
  }
  if (styleProps["font-size"]) {
    styleProps["fontSize"] = styleProps["font-size"];
    delete styleProps["font-size"];
  }
  const bitmask = node.format?.toString(2);
  const bitmaskOffset = bitmask ? bitmask.length - 1 : 0;
  function isBitOne(bit: number) {
    if (!bitmask) {
      return false;
    }
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
  return <span style={styleProps}>{node.text}</span>;
}

function HeadingNodeComponent({
  node,
  path,
}: {
  path: SourcePath;
  node: HeadingNode;
}) {
  return createElement(
    node.tag,
    {},
    node.children.map((child, i) => {
      const childPath = `${path}.${i}` as SourcePath;
      return <TextNodeComponent key={childPath} node={child} />;
    })
  );
}

function ParagraphNodeComponent({
  node,
  path,
}: {
  path: SourcePath;
  node: ParagraphNode;
}) {
  return (
    <p>
      {node.children.map((child, i) => {
        const childPath = `${path}.${i}` as SourcePath;
        switch (child.type) {
          case "text":
            return <TextNodeComponent key={childPath} node={child} />;
          default:
            throw Error("Unknown paragraph node type: " + (child as any)?.type);
        }
      })}
    </p>
  );
}

function ListNodeComponent({
  node,
  path,
}: {
  path: SourcePath;
  node: ListNode;
}) {
  return createElement(
    node.tag,
    {},
    node.children.map((child, i) => {
      const childPath = `${path}.${i}` as SourcePath;
      return (
        <ListItemComponent key={childPath} path={childPath} node={child} />
      );
    })
  );
}

function ListItemComponent({
  node,
  path,
}: {
  path: SourcePath;
  node: ListItemNode;
}) {
  return (
    <li>
      {node.children.map((child, i) => {
        const childPath = `${path}.${i}` as SourcePath;
        switch (child.type) {
          case "text":
            return <TextNodeComponent key={childPath} node={child} />;
          default:
            throw Error("Unknown list item node type: " + (child as any)?.type);
        }
      })}
    </li>
  );
}

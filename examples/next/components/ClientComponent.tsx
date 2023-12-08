"use client";
import { useVal } from "../val/client";
import clientContentVal, { ClientContent } from "./clientContent.val";

export function ClientComponent() {
  const content = useVal(clientContentVal);

  return (
    <div>
      <h1>Client Component</h1>
      <SubComponent content={content} />
    </div>
  );
}

function SubComponent({ content }: { content: ClientContent }) {
  return (
    <div>
      <div>{content.text}</div>
      <h2>Example of union schema:</h2>
      <div
        style={{
          border: "1px solid black",
          padding: "1rem",
          margin: "1rem",
        }}
      >
        {content.objectUnions.type === "object-type-2"
          ? content.objectUnions.value
          : content.objectUnions.type}
      </div>
      <h2>Example of literal enums:</h2>
      <div>
        {content.stringEnum === "lit-1"
          ? "This value is now lit-1"
          : "Value is something else than lit-1"}
      </div>
    </div>
  );
}

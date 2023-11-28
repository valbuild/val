"use client";
import { useVal } from "../val/client";
import clientContentVal from "./clientContent.val";

export function ClientComponent() {
  const content = useVal(clientContentVal);
  return (
    <div>
      <h1>Client Component</h1>
      <span>{content.text}</span>
    </div>
  );
}

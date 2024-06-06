"use client";
import Link from "next/link";
import { useVal } from "../val/client";
import clientContentVal, { ClientContent } from "./clientContent.val";
import linksVal from "./links.val";

export function ClientComponent() {
  const content = useVal(clientContentVal);

  return (
    <SubComponent
      content={content}
      arrays={
        content.arrays
      } /* <- arrays provoked errors in auto-tagging earlier */
    />
  );
}

function SubComponent({
  content,
}: {
  content: ClientContent;
  arrays: ClientContent["arrays"];
}) {
  const links = useVal(linksVal);
  return (
    <Link
      href={links.homepage}
      style={{
        color: "blue",
        textDecoration: "underline",
      }}
    >
      {links.homepage}
    </Link>
  );
}

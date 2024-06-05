import Link from "next/link";
import { fetchVal } from "../val/rsc";
import reactServerContentVal from "./reactServerContent.val";
import linksVal from "./links.val";

export async function ReactServerComponent() {
  const content = await fetchVal(reactServerContentVal);
  const links = await fetchVal(linksVal);
  return (
    <div>
      <h1>ReactServer Component</h1>
      <span>{content}</span>
      <div>Link:</div>
      <Link
        href={links.homepage}
        style={{
          color: "blue",
          textDecoration: "underline",
        }}
      >
        Val homepage (using next/link and rendered in RSC)
      </Link>
    </div>
  );
}

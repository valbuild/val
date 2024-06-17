"use client";
import Link from "next/link";
import { useVal } from "../val/client";
import clientContentVal, { ClientContent } from "./clientContent.val";
import linksVal from "./links.val";
import { GenericSelector, SelectorOf, SelectorSource } from "@valbuild/next";
import { StegaOfSource } from "../../../packages/react/src/stega";
import remoteTestVal from "../app/remote-test.val";
import { Schema, SelectorOfSchema } from "../../../packages/core/src";
import { RemoteSource } from "../../../packages/core/src/source/remote";
import { UseValType } from "../../../packages/next/src/client/initValClient";

export type T<T extends SelectorSource> = SelectorOf<T> extends GenericSelector<
  infer S
>
  ? StegaOfSource<S>
  : never;

type A = StegaOfSource<{ test: string }>;
type B = SelectorOfSchema<Schema<RemoteSource<{ test: string }>>>;
type C = SelectorOf<B>;
type D = UseValType<C>;

export function ClientComponent() {
  const content = useVal(clientContentVal);
  const a = remoteTestVal;
  const testRemote = useVal(remoteTestVal);

  return (
    <div>
      <h1>Client Component</h1>
      <SubComponent
        content={content}
        arrays={
          content.arrays
        } /* <- arrays provoked errors in auto-tagging earlier */
      />
      <h1>Remote content:</h1>
      <div></div>
    </div>
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
    <div>
      <h1>
        <>
          {
            /* fragments provoked errors in auto-tagging earlier */
            [<div key={1}>{content.text}</div>]
          }
        </>
      </h1>
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
      <Link
        href={links.homepage}
        style={{
          color: "blue",
          textDecoration: "underline",
        }}
      >
        Val homepage (using next/link and rendered on client)
      </Link>
    </div>
  );
}

"use client";
import { notFound } from "next/navigation";
import { ValRichText } from "@valbuild/next";
import { useValRoute } from "../../../val/client";
import pageVal from "./page.val";

export default function GenericPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const content = useValRoute(pageVal, params);
  if (!content) {
    notFound();
  }
  return (
    <main>
      <h1>{content.title}</h1>
      {content.sections.map((section, i) => {
        if (section.type === "text") {
          return <ValRichText key={i} content={section.text} />;
        }
        return <pre key={i}>{section.code}</pre>;
      })}
    </main>
  );
}

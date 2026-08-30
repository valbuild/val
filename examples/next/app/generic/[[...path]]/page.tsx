"use client";
import { ValRichText } from "@valbuild/next";
import { notFound } from "next/navigation";
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
      {content.sections.map((section, index) =>
        section.type === "text" ? (
          <ValRichText key={index} content={section.text} />
        ) : (
          <pre key={index}>{section.code}</pre>
        ),
      )}
    </main>
  );
}

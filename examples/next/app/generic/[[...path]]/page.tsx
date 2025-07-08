"use client";
import { notFound } from "next/navigation";
import { useValRoute } from "../../../val/client";
import pageVal from "./page.val";

export default function GenericPage({
  params,
}: {
  params: { path: string[] };
}) {
  const content = useValRoute(pageVal, params);
  if (!content) {
    notFound();
  }
  return (
    <main>
      <h1>{content.title}</h1>
      <p>{content.content}</p>
    </main>
  );
}

"use client";
import { ValProvider } from "@valbuild/react";
import React from "react";

export default function Providers({
  children,
}: {
  children?: React.ReactNode;
}) {
  return <ValProvider host="/api/val">{children}</ValProvider>;
}

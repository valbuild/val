import { ValProvider } from "@valbuild/next";
import "./globals.css";
import { config } from "../val.config";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/*
        <head /> will contain the components returned by the nearest parent
        head.tsx. Find out more at https://beta.nextjs.org/docs/api-reference/file-conventions/head
      */}
      <head />
      <body>
        <ValProvider config={config}>{children}</ValProvider>
      </body>
    </html>
  );
}

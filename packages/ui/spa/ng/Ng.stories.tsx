import type { Meta } from "@storybook/react";
import { Layout } from "./Layout";
const meta: Meta = { title: "Next Gen" };

export default meta;

export const Test1 = {
  render: () => (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Urbanist:ital,wght@0,100..900;1,100..900&display=swap"
        rel="stylesheet"
      ></link>
      <div className="font-[Urbanist]">
        <Layout />
      </div>
    </>
  ),
};

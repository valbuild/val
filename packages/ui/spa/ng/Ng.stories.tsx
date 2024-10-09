import type { Meta } from "@storybook/react";
import { Layout } from "./Layout";
import { ValProvider } from "./ValProvider";
import { ValClient } from "@valbuild/shared/internal";
const meta: Meta = { title: "Next Gen" };

export default meta;

const fakeClient: ValClient = (route, method, params) => {
  throw new Error("Not implemented");
};
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
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap"
        rel="stylesheet"
      ></link>
      <div className="font-[Urbanist]">
        <ValProvider client={fakeClient}>
          <Layout />
        </ValProvider>
      </div>
    </>
  ),
};

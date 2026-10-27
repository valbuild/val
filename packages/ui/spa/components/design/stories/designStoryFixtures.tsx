import { AIChat, type ChatMessage } from "../../AIChat";
import { changedFiles } from "../../../design/changedFiles";
import { lineDiff } from "../../../design/lineDiff";
import { DesignSiteMock } from "./DesignSiteMock";
import type { DesignCheckpoint, DesignTabViewProps } from "../DesignTabView";

/** What the design tab's stories show: one proposal, its files and its chat. */

export const SITE: Record<string, string> = {
  "src/routes/_site.index.tsx": [
    'import { Hero } from "../components/sections/Hero";',
    'import { Quote } from "../components/sections/Quote";',
    'import { ProductGrid } from "../components/sections/ProductGrid";',
    "",
    "function Home() {",
    "  const page = useValRoute(homeVal);",
    "  return (",
    "    <>",
    "      <Hero {...page.hero} />",
    "      <Quote {...page.quote} />",
    "      <ProductGrid {...page.products} />",
    "    </>",
    "  );",
    "}",
    "",
  ].join("\n"),
  "src/components/sections/Quote.tsx":
    "export function Quote() {\n  return null;\n}\n",
  "src/routes/_site.index.val.ts": "export default c.define(/* … */);\n",
};

export const PROPOSAL: Record<string, string | null> = {
  "src/routes/_site.index.tsx": SITE["src/routes/_site.index.tsx"]
    .replace(
      'import { Quote } from "../components/sections/Quote";',
      'import { Testimonials } from "../components/sections/Testimonials";',
    )
    .replace(
      "      <Quote {...page.quote} />",
      "      <Testimonials items={page.testimonials} />",
    ),
  "src/components/sections/Quote.tsx": null,
  "src/components/sections/Testimonials.tsx": [
    "export function Testimonials({ items }: { items: Testimonial[] }) {",
    "  return (",
    '    <section className="bg-subtle px-8 py-12">',
    '      <h2 className="mb-6 text-2xl font-bold">Worn for years, not weeks</h2>',
    "      {items.map((item) => <Card key={item.name} {...item} />)}",
    "    </section>",
    "  );",
    "}",
    "",
  ].join("\n"),
  "src/routes/_site.index.val.ts":
    "export default c.define(/* …, testimonials */);\n",
};

export const FILES = changedFiles(SITE, PROPOSAL, [
  "src/routes/_site.index.tsx",
  "src/components/sections/Quote.tsx",
  "src/components/sections/Testimonials.tsx",
]);

export const CHECKPOINTS: DesignCheckpoint[] = [
  {
    id: "c5",
    message: "Testimonials as cards, three across",
    ago: "2 minutes ago",
    current: true,
  },
  { id: "c4", message: "Testimonials on the front page", ago: "6 minutes ago" },
  {
    id: "c3",
    message: "Testimonials schema: quote, name, place",
    ago: "8 minutes ago",
  },
  {
    id: "c2",
    message: "Remove the unused Quote section",
    ago: "9 minutes ago",
  },
];

export const MESSAGES: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    content:
      "Replace the quote on the front page with a section of customer testimonials. Three of them, as cards.",
    status: "complete",
  },
  {
    id: "a1",
    role: "assistant",
    content:
      "Done, and it is in the preview. I added a **Testimonials** section with its own schema (quote, name, place), put it on the front page where the quote was, and removed the Quote section, which nothing else used.\n\n" +
      "Nothing on the site has changed: it changes when the proposal is published.",
    status: "complete",
    toolActivities: [
      { toolCallId: "t1", name: "list_files", status: "complete" },
      { toolCallId: "t2", name: "read_file", status: "complete" },
      { toolCallId: "t3", name: "write_files", status: "complete" },
      { toolCallId: "t4", name: "build_proposal", status: "complete" },
    ],
  },
];

export const chat = (messages: ChatMessage[]) => (
  <AIChat
    className="h-full"
    initialMessages={messages}
    isConnected
    authError={false}
    mode="http"
    onSendMessage={() => true}
  />
);

export const BASE: DesignTabViewProps = {
  proposal: {
    displayName: "Front page testimonials",
    address: "https://3f9c1e7a2b4d6c8e0a1b--nordic.valstart.dev",
  },
  studioUrl: "https://3f9c1e7a2b4d6c8e0a1b--nordic.valstart.dev/val",
  previewHref: "https://3f9c1e7a2b4d6c8e0a1b--nordic.valstart.dev/",
  route: "/",
  onRouteChange: () => {},
  pages: ["/", "/about", "/products/knitwear", "/products/outerwear"],
  picking: {
    active: false,
    onToggle: () => {},
    status: "live",
    onTurnOn: () => {},
    modifier: "⌥",
  },
  onPublish: () => {},
  onReload: () => {},
  files: FILES,
  diffOf: (path) => lineDiff(SITE[path] ?? null, PROPOSAL[path] ?? null),
  checkpoints: CHECKPOINTS,
  checks: [
    { label: "Types", check: { state: "passed" } },
    { label: "Build", check: { state: "passed", detail: "renders" } },
  ],
  build: { required: false, building: false, progress: null, onBuild: null },
  builder: { kind: "in-tab" },
  problem: null,
  preview: <DesignSiteMock testimonials="cards" />,
  chat: chat(MESSAGES),
};

export const NOT_RENDERED =
  "The build does not render, so the proposal's address still serves its last build. The page answered 200, but its render failed: TypeError: Cannot read properties of undefined (reading 'map')";

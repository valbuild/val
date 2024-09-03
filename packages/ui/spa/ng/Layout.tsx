import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Languages,
  ListFilter,
  Plus,
  Search,
  Tally2,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { useState } from "react";
import classNames from "classnames";
import { ScrollArea } from "@radix-ui/react-scroll-area";

export function Layout() {
  return (
    <div className="absolute top-0 left-0 w-full min-h-screen">
      <main className="grid grid-cols-[284px_auto_284px] grid-rows-[64px_auto] py-4">
        <HeaderLeft />
        <HeaderCenter />
        <HeaderRight />
        <Left />
        <Center />
        <Right />
      </main>
      <LayoutBackground />
    </div>
  );
}

function HeaderLeft() {
  return (
    <div className="flex items-center gap-4 px-5 pt-4 ml-4 bg-primary-foreground rounded-t-3xl">
      <div>
        <FakeIcon />
      </div>
      <List />
    </div>
  );
}

function Left() {
  return (
    <div className="flex flex-col justify-between pb-4 ml-4 bg-primary-foreground rounded-b-3xl">
      <nav>
        <Divider />
        <ScrollArea className="max-h-[max(50vh-40px,200px)] overflow-scroll">
          <Explorer
            title="Blank website"
            items={["Projects", "Benefits", "Darkside", "Salary", "Working"]}
          />
        </ScrollArea>
        <Divider />
        <ScrollArea className="max-h-[max(50vh-40px,200px)] overflow-scroll">
          <Explorer
            title="Pages"
            items={[
              "Projects",
              "About",
              "Events",
              "Positions",
              "Jobs",
              "Contacts",
            ]}
          />
        </ScrollArea>
      </nav>
    </div>
  );
}

function Explorer({ items, title }: { title: string; items: string[] }) {
  return (
    <div className="px-2">
      <div className="py-2">{title}</div>
      <div>
        {items.map((item, i) => (
          <div className="flex justify-between p-2" key={i}>
            <span className="flex items-center text-sm">
              <Tally2 />
              <span>{item}</span>
            </span>
            <ChevronRight />
          </div>
        ))}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="w-full pt-4 mb-4 border-b border-border" />;
}

function Author() {
  return (
    <img
      src="https://randomuser.me/api/portraits/women/75.jpg"
      className="w-8 h-8 rounded-full"
    />
  );
}

function List() {
  return (
    <Button
      className="flex items-center justify-between w-full rounded-3xl bg-primary-foreground border-primary-foreground"
      variant="outline"
    >
      <span>Blank Oslo</span>
      <ChevronsUpDown size={16} />
    </Button>
  );
}

function HeaderCenter() {
  return (
    <div className="flex items-center justify-center mx-4">
      <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-background font-[SpaceGrotesk] w-fit">
        <span className="text-muted">Blank Website</span>
        <span className="text-muted"> /</span>
        <span className="text-muted">Aidn</span>
        <span className="text-muted">/</span>
        <span>Item</span>
      </div>
    </div>
  );
}

function Center() {
  return <div className="p-4 mx-4 mb-4">C enter</div>;
}

function HeaderRight() {
  return (
    <div className="flex items-center justify-between p-4 mr-4 text-sm bg-primary-foreground rounded-t-3xl">
      <div className="flex items-center gap-2">
        <Button variant="secondary">Preview</Button>
        <Button>Publish</Button>
      </div>
      <Author />
    </div>
  );
}

function Right() {
  return (
    <div className="pb-4 mr-4 text-sm rounded-b-3xl bg-primary-foreground h-fit">
      <Divider />
      <Tools />
      <Divider />
      <Tabs />
    </div>
  );
}

function Tools() {
  return (
    <div className="flex items-center gap-4 px-4 justify-evenly">
      <button>
        <Plus size={16} />
      </button>
      <button>
        <ArrowUpDown size={16} />
      </button>
      <button>
        <ListFilter size={16} />
      </button>
      <button>
        <div className="flex items-center gap-2">
          <Languages size={16} />
          <ChevronDown size={16} />
        </div>
      </button>
      <button>
        <Search size={16} />
      </button>
    </div>
  );
}

function Tabs() {
  const [activeTab, setActiveTab] = useState<"changes" | "errors">("changes");
  return (
    <ScrollArea className="max-h-[max(50vh-40px,200px)] overflow-scroll px-4">
      <div className="flex gap-4">
        <button
          onClick={() => setActiveTab("changes")}
          className={classNames({ "text-muted": activeTab !== "changes" })}
        >
          Changes
        </button>
        <button
          onClick={() => setActiveTab("errors")}
          className={classNames({ "text-muted": activeTab !== "errors" })}
        >
          Errors
        </button>
      </div>
      {activeTab === "changes" && <PendingChanges />}
      {activeTab === "errors" && <ValidationErrors />}
    </ScrollArea>
  );
}

function PendingChanges() {
  const items = [
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
    "https://randomuser.me/api/portraits/women/71.jpg",
    "https://randomuser.me/api/portraits/women/51.jpg",
    "https://randomuser.me/api/portraits/women/12.jpg",
    "https://randomuser.me/api/portraits/women/33.jpg",
    "https://randomuser.me/api/portraits/women/15.jpg",
  ];
  return (
    <div>
      {items.map((item, i) => (
        <div className="flex justify-between py-2 text-xs" key={i}>
          <span className="flex items-center gap-4 ">
            <img src={item} className="w-8 h-8 rounded-full" />
            <span className="truncate">3 changes</span>
          </span>
          <span className="flex items-center gap-4 text-muted-foreground">
            <span className="truncate">2 days ago</span>
            <ChevronDown />
          </span>
        </div>
      ))}
    </div>
  );
}

function ValidationErrors() {
  const items = ["Menneskene", "Blogs", "Contact", "Content"];
  return (
    <div>
      {items.map((item, i) => (
        <div className="flex justify-between py-2 text-xs" key={i}>
          <span className="flex items-center gap-4 ">{item}</span>
          <span className="flex items-center gap-4 text-muted-foreground">
            <span className="truncate">2 days ago</span>
            <ChevronDown />
          </span>
        </div>
      ))}
    </div>
  );
}

function LayoutBackground() {
  return (
    <div
      className="absolute top-0 left-0 w-full h-full -z-5"
      style={{
        background: `
        radial-gradient(circle 50vw at 42% 20%, rgba(31,42,61,1), rgba(0,0,0,0.4)),
radial-gradient(circle 60vw at 94% 45%, rgba(105,88,119,1), rgba(0,0,0,0.3)),
radial-gradient(circle 80vw at 96% 95%, rgba(86,154,130,1), rgba(0,0,0,0.1)),
radial-gradient(circle 50vw at 28% 23%, rgba(2,8,23,1), rgba(0,0,0,0.7)),
url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='6.48' numOctaves='1' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")
`,
      }}
    />
  );
}

function FakeIcon() {
  return (
    <svg
      width="48"
      height="49"
      viewBox="0 0 48 49"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="24.5" r="24" fill="#272D2A" />
      <path
        d="M26.1786 19.4509C23.991 19.4509 22.2502 20.5704 21.1792 22.3943V10.625C19.0041 11.035 18.234 11.1831 16.625 11.4617V11.7854C17.4597 12.0984 17.5849 12.1586 18.2953 12.4749V35.9783H21.1792V33.9703C23.3229 37.4006 28.4665 36.9178 31.0296 34.0707C35.6717 29.5678 33.0961 19.3338 26.1786 19.4509ZM28.3289 33.516C26.5052 35.8101 22.668 35.9222 21.1784 33.4884C21.1784 30.8437 21.1784 25.5225 21.1784 22.8795C22.6581 20.0491 26.7796 20.3537 28.4491 22.8837C30.4758 25.2439 30.5007 31.3515 28.3289 33.516Z"
        fill="#FFFCB6"
      />
    </svg>
  );
}

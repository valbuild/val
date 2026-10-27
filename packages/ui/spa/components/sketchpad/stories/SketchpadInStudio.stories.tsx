import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { AIChat, type ChatMessage } from "../../AIChat";
import { Shell } from "../../shell/Shell";
import { mockSelectionIds, mockShellData } from "../../shell/mockShellData";
import { Sketchpad, type SketchpadPerson } from "../Sketchpad";

/**
 * Sketchpad where it would live: in the Studio's editor column, beside the
 * assistant. The column is the slot the compare and errors views use -- it
 * keeps the top bar, Publish and the chat working around it -- and the
 * Sketchpad belongs to the page that is open, so the page's heading is its
 * title.
 *
 * In a proposal it is shared the way the proposal's chats are (Flow H): its
 * people are in the header, and the document is what is synced between them.
 *
 * Resize the preview to see the phone layout: below 768px the column takes
 * the screen and the chat is a sheet over it.
 */
const meta: Meta<typeof SketchpadInStudio> = {
  title: "Components/Sketchpad/In the Studio",
  component: SketchpadInStudio,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;
type Story = StoryObj<typeof SketchpadInStudio>;

const SKETCH = `# Our people
We are 40 designers and developers in Oslo.
[hero: The whole team on the roof](image: /storybook-media/intro-poster_a627f.webp)
row
  col
    ## Design
    [people: Designers, with portraits]
  col
    ## Development
    [people: Developers, with portraits]
## Join us
row
  col 2
    We are hiring for three roles this spring.
    [jobs: Open positions, from the careers feed]
  col
    [button: See open positions]

icon hero M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6
icon people M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75
icon jobs M3 7h18v13H3z M8 7V4h8v3 M3 12h18
icon button M3 8h18v8H3z M8 12h8
`;

const PEOPLE: SketchpadPerson[] = [
  { name: "Fredrik Ekholdt", you: true },
  { name: "Kari Nordmann" },
];

const MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    content:
      "Sketch an Our people page: the team, design and development side by side, and a hiring section.",
    status: "complete",
  },
  {
    id: "m2",
    role: "assistant",
    content:
      "I've sketched it in the Sketchpad: a hero photo, design and development in two columns, and a Join us section with the open positions. Change anything there, add photos to the boxes, and tell me when to build it.",
    status: "complete",
  },
];

type Props = {
  /** The assistant's chat, beside the Sketchpad (over it on a phone). */
  chatOpen: boolean;
  /** In a proposal, with someone else working on it too. */
  inProposal: boolean;
  theme: "dark" | "light";
};

function SketchpadInStudio({ chatOpen, inProposal, theme }: Props) {
  const [value, setValue] = useState(SKETCH);
  const [currentTheme, setTheme] = useState(theme);
  return (
    <Shell
      key={`${chatOpen}-${theme}`}
      data={mockShellData}
      theme={currentTheme}
      onThemeChange={setTheme}
      initialSelectionId={mockSelectionIds.home}
      initialPanel={chatOpen ? "ai" : null}
      aiEnabled
      aiSlot={
        <AIChat
          isConnected
          authError={false}
          mode="http"
          initialMessages={MESSAGES}
          onSendMessage={() => true}
        />
      }
      pendingChanges={3}
      onCompare={() => console.log("open the review view")}
      editorOverride={
        <div className="flex h-full min-h-0 flex-col p-2 md:p-3">
          <Sketchpad
            value={value}
            onChange={setValue}
            title="/people"
            people={inProposal ? PEOPLE : undefined}
            status={
              inProposal
                ? "In ⎇ Spring campaign, with Kari"
                : "Sketched by the assistant · not built yet"
            }
          />
        </div>
      }
    />
  );
}

export const WithTheAssistant: Story = {
  args: { chatOpen: true, inProposal: false, theme: "light" },
};

export const SketchpadAlone: Story = {
  args: { chatOpen: false, inProposal: false, theme: "light" },
};

export const InAProposal: Story = {
  args: { chatOpen: true, inProposal: true, theme: "dark" },
};

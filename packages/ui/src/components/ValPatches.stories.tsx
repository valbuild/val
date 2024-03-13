import { ModuleId } from "@valbuild/core";
import {
  History,
  ReviewErrors,
  ReviewModuleError,
  ReviewPanel as ReviewPanelComponent,
} from "./ValPatches";
import { ValUIContext } from "./ValUIContext";
import { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof ReviewPanelComponent> = {
  component: ReviewPanelComponent,
  title: "ReviewPanel",
  render: (args) => (
    <ValUIContext.Provider
      value={{
        theme: "light",
        setTheme: () => {},
        editMode: "full",
        setEditMode: () => {},
        session: {
          status: "success",
          data: { enabled: true, mode: "local" },
        },
        setWindowSize: () => {},
      }}
    >
      <div className="p-4 bg-background">
        <ReviewPanelComponent {...args} />
      </div>
    </ValUIContext.Provider>
  ),
};
export default meta;
type Story = StoryObj<typeof ReviewPanelComponent>;

export const ReviewPanel: Story = {
  args: {
    history: [
      {
        author: {
          name: "Fredrik Ekholdt",
          avatarUrl: "https://randomuser.me/api/portraits/men/3.jpg",
        },
        lastChangedAt: "2024.01.02",
        changeCount: 4,
        changes: [
          {
            moduleId: "/app/content",
            items: [
              {
                path: '1."title"',
                type: "replace",
                count: 3,
                changedAt: "2024.01.01",
              },
              {
                path: '1."title"',
                type: "replace",
                count: 1,
                changedAt: "2024.01.02",
              },
            ],
          },
        ],
      },
      {
        lastChangedAt: "2024.01.02",
        changeCount: 4,
        changes: [
          {
            moduleId: "/app/content",
            items: [
              {
                path: '1."title"',
                type: "replace",
                count: 3,
                changedAt: "2024.01.02",
              },
              {
                path: '1."title"',
                type: "replace",
                count: 1,
                changedAt: "2024.01.02",
              },
            ],
          },
        ],
      },
      {
        author: {
          name: "Erlend Åmdal",
        },
        lastChangedAt: "2024.01.02",
        changeCount: 4,
        changes: [
          {
            moduleId: "/app/content",
            items: [
              {
                path: '1."title"',
                type: "replace",
                count: 3,
                changedAt: "2024.01.02",
              },
              {
                path: '1."title"',
                type: "replace",
                count: 1,
                changedAt: "2024.01.02",
              },
            ],
          },
        ],
      },
      {
        author: {
          name: "Fredrik Ekholdt",
          avatarUrl: "https://randomuser.me/api/portraits/men/3.jpg",
        },
        lastChangedAt: "2024.01.02",
        changeCount: 1,
        changes: [
          {
            moduleId: "/app/content",
            items: [
              {
                path: '1."title"',
                type: "replace",
                count: 1,
                changedAt: "2024.01.02",
              },
            ],
          },
        ],
      },
    ] as History,
    errors: {
      errors: {
        "/app/fatal-example": {
          fatalErrors: [
            "Module id: '/app/fatal' does not match filepath: /app/fatal-example",
          ],
          validations: [],
        },
        "/app/content": {
          validations: [
            {
              path: '1."title"',
              lastChangedBy: {
                name: "Fredrik Ekholdt",
                avatarUrl: "https://randomuser.me/api/portraits/men/3.jpg",
              },
              lastChangedAt: "2024.01.02",
              messages: [
                {
                  message:
                    "Text length is 3 characters: must be between 10 and 100 characters",
                  severity: "warning",
                },
                {
                  message:
                    "Text is 'Hello': must correspond to pattern 'CMS|Test'",
                  severity: "warning",
                },
              ],
            },
          ] as ReviewModuleError["validations"],
        },
        "/app/example": {
          validations: [
            {
              path: '1.0."test"."foo"."long-list".3',
              lastChangedBy: {
                name: "Fredrik Ekholdt",
              },
              messages: [
                {
                  severity: "error",
                  message: "Text cannot be empty",
                },
              ],
            },
          ] as ReviewModuleError["validations"],
        },
      },
    } as ReviewErrors,
  },
};

import { ModuleId } from "@valbuild/core";
import {
  History,
  ReviewErrors,
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
        lastChangedAt: "3 days ago",
        changeCount: 4,
        changes: [
          {
            moduleId: "/app/content",
            items: [
              {
                path: '1."title"',
                type: "replace",
                count: 3,
                changedAt: "3 days ago",
              },
              {
                path: '1."title"',
                type: "replace",
                count: 1,
                changedAt: "3 days ago",
              },
            ],
          },
        ],
      },
      {
        author: {
          name: "Erlend Åmdal",
        },
        lastChangedAt: "yesterday",
        changeCount: 4,
        changes: [
          {
            moduleId: "/app/content",
            items: [
              {
                path: '1."title"',
                type: "replace",
                count: 3,
                changedAt: "2 days ago",
              },
              {
                path: '1."title"',
                type: "replace",
                count: 1,
                changedAt: "yesterday",
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
        lastChangedAt: "today",
        changeCount: 1,
        changes: [
          {
            moduleId: "/app/content",
            items: [
              {
                path: '1."title"',
                type: "replace",
                count: 1,
                changedAt: "today",
              },
            ],
          },
        ],
      },
    ] as History,
    errors: {
      errors: {
        "/app/content": [
          {
            path: '1."title"',
            lastChangedBy: {
              name: "Fredrik Ekholdt",
              avatarUrl: "https://randomuser.me/api/portraits/men/3.jpg",
            },
            lastedChangedAt: "yesterday",
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
        ] as ReviewErrors["errors"][ModuleId],
        "/app/example": [
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
        ] as ReviewErrors["errors"][ModuleId],
      },
    } as ReviewErrors,
  },
};

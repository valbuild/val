import { ReviewPanel as ReviewPanelComponent } from "./ValPatches";
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
    history: {
      "module-id": [
        {
          path: "path",
          patchType: "replace",
        },
      ],
    } as History,
    errors: {} as ReviewErrors,
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import {Dropdown} from "./Dropdown";

const meta: Meta<typeof Dropdown> = { component: Dropdown };

export default meta;
type Story = StoryObj<typeof Dropdown>;

export const Default: Story = {
  render: () => (
    <Dropdown>
        <Dropdown.Child>
            hade
        </Dropdown.Child>
        <Dropdown.Child>
            påbade din gamle sjokolade
        </Dropdown.Child>
    </Dropdown>
  ),
};
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ButtonVariantPicker } from "./ButtonVariantPickerComponent";
import type { EditorButtonVariant, EditorLinkCatalogItem } from "../types";

const buttonSpecificCatalog: EditorLinkCatalogItem[] = [
  { title: "Home", subtitle: "/home", href: "/home" },
  { title: "About", subtitle: "/about", href: "/about" },
  { title: "Contact", subtitle: "/contact", href: "/contact" },
];

const simpleVariants: EditorButtonVariant[] = [
  { variant: "cta-button", label: "CTA Button", children: false },
  { variant: "generic-button", label: "Generic Button", children: "string" },
];

const variantsWithFreeformLink: EditorButtonVariant[] = [
  { variant: "cta-button", label: "CTA Button", children: false },
  { variant: "generic-button", label: "Generic Button", children: "string" },
  {
    variant: "link-button",
    label: "Link Button",
    children: "string",
    link: true,
  },
];

const variantsWithCatalogLink: EditorButtonVariant[] = [
  { variant: "cta-button", label: "CTA Button", children: false },
  {
    variant: "nav-button",
    label: "Nav Button",
    children: "string",
    link: buttonSpecificCatalog,
  },
  {
    variant: "link-button",
    label: "Link Button",
    children: "string",
    link: true,
  },
];

function PickerContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[280px] rounded-md border border-border-primary bg-bg-primary p-1 shadow-lg">
      {children}
    </div>
  );
}

const meta: Meta<typeof ButtonVariantPicker> = {
  title: "RichTextEditor/ButtonVariantPicker",
  component: ButtonVariantPicker,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-md p-4">
        <PickerContainer>
          <Story />
        </PickerContainer>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ButtonVariantPicker>;

export const SimpleVariants: Story = {
  args: {
    variants: simpleVariants,
    currentVariant: "cta-button",
    currentHref: null,
    onSelectVariant: (variant, href) => console.log("Selected:", variant, href),
    onClose: () => console.log("Close"),
  },
};

export const WithFreeformLink: Story = {
  args: {
    variants: variantsWithFreeformLink,
    currentVariant: "generic-button",
    currentHref: null,
    onSelectVariant: (variant, href) => console.log("Selected:", variant, href),
    onClose: () => console.log("Close"),
  },
};

export const WithCatalogLink: Story = {
  args: {
    variants: variantsWithCatalogLink,
    currentVariant: "cta-button",
    currentHref: null,
    onSelectVariant: (variant, href) => console.log("Selected:", variant, href),
    onClose: () => console.log("Close"),
  },
};

export const ExistingLinkVariant: Story = {
  args: {
    variants: variantsWithCatalogLink,
    currentVariant: "nav-button",
    currentHref: "/home",
    onSelectVariant: (variant, href) => console.log("Selected:", variant, href),
    onClose: () => console.log("Close"),
  },
};

function InteractiveStory() {
  const [selected, setSelected] = useState<{
    variant: string;
    href?: string;
  }>({ variant: "cta-button" });

  return (
    <div className="flex flex-col gap-4">
      <PickerContainer>
        <ButtonVariantPicker
          variants={variantsWithCatalogLink}
          currentVariant={selected.variant}
          currentHref={selected.href ?? null}
          onSelectVariant={(variant, href) => setSelected({ variant, href })}
          onClose={() => console.log("Close")}
        />
      </PickerContainer>
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <div className="text-sm font-bold text-fg-secondary">Selected</div>
        <pre className="mt-1 text-xs text-fg-secondary-alt">
          {JSON.stringify(selected, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <InteractiveStory />,
};

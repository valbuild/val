import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { GalleryUploadTarget } from "../GalleryUploadTarget";

const meta: Meta<typeof GalleryUploadTarget> = {
  title: "Components/MediaPicker/GalleryUploadTarget",
  component: GalleryUploadTarget,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof GalleryUploadTarget>;

export const TwoModules: Story = {
  render: function Render() {
    const [selected, setSelected] = useState("/content/media.val.ts");
    return (
      <div className="w-96">
        <GalleryUploadTarget
          modulePaths={["/content/media.val.ts", "/content/blog-images.val.ts"]}
          selectedPath={selected}
          onSelect={setSelected}
        />
        <p className="mt-2 text-xs text-fg-secondary">Raw path: {selected}</p>
      </div>
    );
  },
};

export const ThreeModules: Story = {
  render: function Render() {
    const [selected, setSelected] = useState("/content/media.val.ts");
    return (
      <div className="w-96">
        <GalleryUploadTarget
          modulePaths={[
            "/content/media.val.ts",
            "/content/blog-images.val.ts",
            "/content/product-images.val.ts",
          ]}
          selectedPath={selected}
          onSelect={setSelected}
        />
      </div>
    );
  },
};

export const NestedModulePaths: Story = {
  render: function Render() {
    const [selected, setSelected] = useState(
      "/content/pages/hero-images.val.ts",
    );
    return (
      <div className="w-96">
        <GalleryUploadTarget
          modulePaths={[
            "/content/pages/hero-images.val.ts",
            "/content/pages/gallery.val.ts",
            "/schema/product_photos.val.ts",
          ]}
          selectedPath={selected}
          onSelect={setSelected}
        />
        <p className="mt-2 text-xs text-fg-secondary">
          Shows: "pages / hero images", "pages / gallery", "product photos"
        </p>
      </div>
    );
  },
};

export const DefaultSelection: Story = {
  render: () => (
    <div className="w-96">
      <GalleryUploadTarget
        modulePaths={["/content/media.val.ts", "/content/blog-images.val.ts"]}
      />
    </div>
  ),
};

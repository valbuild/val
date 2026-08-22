import type { Meta, StoryObj } from "@storybook/react";
import { SerializedSvgSchema } from "@valbuild/core";
import { useState } from "react";
import { SvgColorMapper, SvgEditor, SvgRender } from "./SvgField";
import type { GenericSvgSource } from "@valbuild/core";

const iconSchema: SerializedSvgSchema = {
  type: "svg",
  opt: false,
  options: {
    width: 24,
    height: 24,
    aspectRatio: "1:1",
    variables: {
      brand: "#0055ff",
      line: "#1f2933",
      surface: { value: "#ffffff", match: ["#fefefe"] },
    },
  },
};

const bell: GenericSvgSource = {
  viewBox: "0 0 24 24",
  width: 24,
  height: 24,
  children: [
    {
      tag: "path",
      attrs: {
        d: "M12 2.5A5.5 5.5 0 0 0 6.5 8v4.2L4.8 15.2a.6.6 0 0 0 .52.9h13.36a.6.6 0 0 0 .52-.9L17.5 12.2V8A5.5 5.5 0 0 0 12 2.5Z",
        fill: { var: "brand" },
      },
      children: [],
    },
    {
      tag: "path",
      attrs: {
        d: "M9.6 18.5a2.4 2.4 0 0 0 4.8 0",
        stroke: { var: "line" },
        "stroke-width": 1.6,
        "stroke-linecap": "round",
        fill: "none",
      },
      children: [],
    },
    {
      tag: "circle",
      attrs: { cx: 17.5, cy: 6, r: 2.6, fill: { var: "surface" } },
      children: [],
    },
  ],
};

const meta: Meta<typeof SvgEditor> = {
  title: "Fields/SvgField",
  component: SvgEditor,
  parameters: { layout: "padded" },
};
export default meta;

/**
 * The default, and what an editor sees almost every time: just the icon, the
 * palette it uses, and a dark mode toggle. Icons are read far more often than
 * they are replaced, so nothing else is on screen until you drop an svg on the
 * tile, paste markup into it, or click it to pick a file.
 */
export const WithIcon: StoryObj<typeof SvgEditor> = {
  render: () => {
    const [source, setSource] = useState<GenericSvgSource | null>(bell);
    return (
      <div className="max-w-2xl">
        <SvgEditor schema={iconSchema} source={source} onChange={setSource} />
      </div>
    );
  },
};

/** An empty field. The tile is the drop target and the file picker. */
export const Empty: StoryObj<typeof SvgEditor> = {
  render: () => {
    const [source, setSource] = useState<GenericSvgSource | null>(null);
    return (
      <div className="max-w-2xl">
        <SvgEditor schema={iconSchema} source={source} onChange={setSource} />
      </div>
    );
  },
};

/** Read only: the tile is inert, and the icon is all there is. */
export const Readonly: StoryObj<typeof SvgEditor> = {
  render: () => (
    <div className="max-w-2xl">
      <SvgEditor
        schema={iconSchema}
        source={bell}
        onChange={() => {}}
        readonly
      />
    </div>
  ),
};

/**
 * Dropping an export whose colors are not in the palette. The mapping controls
 * appear only now, and the icon is not committed until every color has
 * somewhere to go - a half mapped icon would silently lose fills.
 *
 * Copy the markup below and paste it onto the tile to drive it yourself.
 */
export const UnmatchedColors: StoryObj<typeof SvgEditor> = {
  render: () => {
    const [source, setSource] = useState<GenericSvgSource | null>(null);
    return (
      <div className="max-w-2xl">
        <SvgEditor schema={iconSchema} source={source} onChange={setSource} />
        <p className="mt-4 text-xs text-text-secondary">
          Paste this onto the tile:
        </p>
        <pre className="mt-1 p-2 text-xs bg-bg-secondary rounded overflow-x-auto">
          {`<svg width="24" height="24" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="10" fill="#ff5c00"/>
  <path d="M8 12h8" stroke="#123456" stroke-width="2"/>
</svg>`}
        </pre>
      </div>
    );
  },
};

/** The color mapper on its own, with two colors still to place. */
export const ColorMapper: StoryObj<typeof SvgColorMapper> = {
  render: () => {
    const [value, setValue] = useState({});
    return (
      <div className="max-w-2xl">
        <SvgColorMapper
          unmatched={[
            { raw: "#ff5c00", normalized: "#ff5c00", count: 3 },
            { raw: "#123456", normalized: "#123456", count: 1 },
          ]}
          variables={iconSchema.options?.variables ?? {}}
          value={value}
          onChange={setValue}
          allowLiterals
        />
      </div>
    );
  },
};

/**
 * The same source at several sizes, and with the variables overridden - which
 * is what `<ValSvg vars={...} />` and a dark mode stylesheet each do.
 */
export const Rendering: StoryObj<typeof SvgRender> = {
  render: () => {
    const variables = iconSchema.options?.variables ?? {};
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-end gap-4">
          {[16, 24, 32, 48, 64].map((size) => (
            <div key={size} className="flex flex-col items-center gap-1">
              <SvgRender source={bell} variables={variables} size={size} />
              <span className="text-xs text-text-secondary">{size}px</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-1 p-3 rounded bg-white">
            <SvgRender source={bell} variables={variables} size={48} />
            <span className="text-xs text-black">example colors</span>
          </div>
          <div className="flex flex-col items-center gap-1 p-3 rounded bg-black">
            <SvgRender
              source={bell}
              variables={variables}
              overrides={{
                brand: "#6699ff",
                line: "#e5e7eb",
                surface: "#111111",
              }}
              size={48}
            />
            <span className="text-xs text-white">dark mode</span>
          </div>
          <div className="flex flex-col items-center gap-1 p-3 rounded bg-white">
            <SvgRender
              source={bell}
              variables={variables}
              overrides={{
                brand: "#dc2626",
                line: "#7f1d1d",
                surface: "#fee2e2",
              }}
              size={48}
            />
            <span className="text-xs text-black">vars override</span>
          </div>
        </div>
      </div>
    );
  },
};

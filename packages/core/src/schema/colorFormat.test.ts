import {
  ColorFormat,
  colorToHex,
  convertColor,
  detectColorFormat,
  formatColor,
  oklchToRgb,
  parseColor,
  rgbToOklch,
} from "./colorFormat";

describe("parseColor", () => {
  test("hex: 6 digits", () => {
    expect(parseColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  test("hex: uppercase", () => {
    expect(parseColor("#3B82F6")).toEqual({ r: 59, g: 130, b: 246, a: 1 });
  });

  test("hex: 3 digits expands", () => {
    expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
  });

  test("hex: 8 digits carries alpha", () => {
    expect(parseColor("#ff000080")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 128 / 255,
    });
  });

  test("hex: 4 digits carries alpha", () => {
    expect(parseColor("#f00f")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  test("hex: invalid lengths and characters", () => {
    expect(parseColor("#ff")).toBeNull();
    expect(parseColor("#fffff")).toBeNull();
    expect(parseColor("#gggggg")).toBeNull();
    expect(parseColor("#")).toBeNull();
  });

  test("rgb: modern space syntax", () => {
    expect(parseColor("rgb(59 130 246)")).toEqual({
      r: 59,
      g: 130,
      b: 246,
      a: 1,
    });
  });

  test("rgb: modern syntax with alpha", () => {
    expect(parseColor("rgb(59 130 246 / 0.5)")).toEqual({
      r: 59,
      g: 130,
      b: 246,
      a: 0.5,
    });
  });

  test("rgb: legacy comma syntax", () => {
    expect(parseColor("rgb(59, 130, 246)")).toEqual({
      r: 59,
      g: 130,
      b: 246,
      a: 1,
    });
  });

  test("rgba: legacy comma syntax with alpha", () => {
    expect(parseColor("rgba(59, 130, 246, 0.25)")).toEqual({
      r: 59,
      g: 130,
      b: 246,
      a: 0.25,
    });
  });

  test("rgb: percentage channels", () => {
    expect(parseColor("rgb(100% 0% 0%)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
  });

  test("rgb: percentage alpha", () => {
    expect(parseColor("rgb(255 0 0 / 50%)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 0.5,
    });
  });

  test("rgb: out of range channels are clamped", () => {
    expect(parseColor("rgb(300 -20 0)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
  });

  test("rgb: mixing comma and slash syntax is rejected", () => {
    expect(parseColor("rgb(255, 0, 0 / 0.5)")).toBeNull();
  });

  test("rgb: wrong number of components", () => {
    expect(parseColor("rgb(255 0)")).toBeNull();
    expect(parseColor("rgb(255 0 0 0)")).toBeNull();
    expect(parseColor("rgb()")).toBeNull();
  });

  test("hsl: modern space syntax", () => {
    const parsed = parseColor("hsl(0 100% 50%)");
    expect(parsed).not.toBeNull();
    expect(colorToHex(parsed!)).toBe("#ff0000");
  });

  test("hsl: legacy comma syntax", () => {
    const parsed = parseColor("hsl(120, 100%, 50%)");
    expect(parsed).not.toBeNull();
    expect(colorToHex(parsed!)).toBe("#00ff00");
  });

  test("hsla: legacy comma syntax with alpha", () => {
    expect(parseColor("hsla(0, 100%, 50%, 0.5)")?.a).toBe(0.5);
  });

  test("hsl: hue units", () => {
    const asDeg = parseColor("hsl(120deg 100% 50%)");
    expect(colorToHex(asDeg!)).toBe("#00ff00");
    expect(colorToHex(parseColor("hsl(0.3333333turn 100% 50%)")!)).toBe(
      "#00ff00",
    );
    expect(colorToHex(parseColor("hsl(133.3333grad 100% 50%)")!)).toBe(
      "#00ff00",
    );
    expect(colorToHex(parseColor("hsl(2.0943951rad 100% 50%)")!)).toBe(
      "#00ff00",
    );
  });

  test("hsl: negative hue wraps", () => {
    expect(colorToHex(parseColor("hsl(-120 100% 50%)")!)).toBe("#0000ff");
  });

  test("hsl: grey has no hue", () => {
    expect(parseColor("hsl(0 0% 50%)")).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
  });

  test("oklch: white, black and red", () => {
    expect(colorToHex(parseColor("oklch(1 0 0)")!)).toBe("#ffffff");
    expect(colorToHex(parseColor("oklch(0 0 0)")!)).toBe("#000000");
    expect(colorToHex(parseColor("oklch(0.62796 0.25768 29.23)")!)).toBe(
      "#ff0000",
    );
  });

  test("oklch: percentage lightness", () => {
    expect(colorToHex(parseColor("oklch(100% 0 0)")!)).toBe("#ffffff");
  });

  test("oklch: with alpha", () => {
    expect(parseColor("oklch(0.5 0.1 30 / 0.4)")?.a).toBe(0.4);
  });

  test("oklch: out of gamut is clipped", () => {
    // Way outside sRGB, but must still produce a usable color
    const parsed = parseColor("oklch(0.7 0.4 150)");
    expect(parsed).not.toBeNull();
    expect(parsed!.r).toBeGreaterThanOrEqual(0);
    expect(parsed!.g).toBeLessThanOrEqual(255);
  });

  test("unsupported notations", () => {
    expect(parseColor("red")).toBeNull();
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("lab(50% 40 59.5)")).toBeNull();
    expect(parseColor("color(display-p3 1 0 0)")).toBeNull();
    expect(parseColor("")).toBeNull();
    expect(parseColor("   ")).toBeNull();
  });

  test("surrounding whitespace is allowed", () => {
    expect(parseColor("  #ff0000  ")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });
});

describe("detectColorFormat", () => {
  test("detects the family from the syntax alone", () => {
    expect(detectColorFormat("#fff")).toBe("hex");
    expect(detectColorFormat("rgb(1 2 3)")).toBe("rgb");
    expect(detectColorFormat("rgba(1,2,3,1)")).toBe("rgb");
    expect(detectColorFormat("hsl(1 2% 3%)")).toBe("hsl");
    expect(detectColorFormat("hsla(1,2%,3%,1)")).toBe("hsl");
    expect(detectColorFormat("oklch(0.5 0.1 30)")).toBe("oklch");
    expect(detectColorFormat("RGB(1 2 3)")).toBe("rgb");
    expect(detectColorFormat("red")).toBeNull();
  });

  test("does not imply the value parses", () => {
    expect(detectColorFormat("hsl(nope)")).toBe("hsl");
    expect(parseColor("hsl(nope)")).toBeNull();
  });
});

describe("formatColor", () => {
  test("hex", () => {
    expect(formatColor({ r: 59, g: 130, b: 246, a: 1 }, "hex")).toBe("#3b82f6");
  });

  test("hex: alpha is appended only when transparent", () => {
    expect(formatColor({ r: 255, g: 0, b: 0, a: 1 }, "hex")).toBe("#ff0000");
    expect(formatColor({ r: 255, g: 0, b: 0, a: 0.5 }, "hex")).toBe(
      "#ff000080",
    );
  });

  test("rgb: modern space syntax", () => {
    expect(formatColor({ r: 59, g: 130, b: 246, a: 1 }, "rgb")).toBe(
      "rgb(59 130 246)",
    );
    expect(formatColor({ r: 59, g: 130, b: 246, a: 0.5 }, "rgb")).toBe(
      "rgb(59 130 246 / 0.5)",
    );
  });

  test("hsl", () => {
    expect(formatColor({ r: 255, g: 0, b: 0, a: 1 }, "hsl")).toBe(
      "hsl(0 100% 50%)",
    );
    expect(formatColor({ r: 0, g: 255, b: 0, a: 0.25 }, "hsl")).toBe(
      "hsl(120 100% 50% / 0.25)",
    );
  });

  test("oklch", () => {
    expect(formatColor({ r: 255, g: 255, b: 255, a: 1 }, "oklch")).toBe(
      "oklch(1 0 0)",
    );
    expect(formatColor({ r: 0, g: 0, b: 0, a: 1 }, "oklch")).toBe(
      "oklch(0 0 0)",
    );
    // Björn Ottosson's reference value for sRGB red
    expect(formatColor({ r: 255, g: 0, b: 0, a: 1 }, "oklch")).toBe(
      "oklch(0.628 0.2577 29.23)",
    );
  });

  test("channels are rounded, not truncated", () => {
    expect(formatColor({ r: 127.5, g: 127.5, b: 127.5, a: 1 }, "rgb")).toBe(
      "rgb(128 128 128)",
    );
  });
});

describe("convertColor", () => {
  const formats: ColorFormat[] = ["hex", "rgb", "hsl", "oklch"];

  test("converts between all formats", () => {
    expect(convertColor("#3b82f6", "rgb")).toBe("rgb(59 130 246)");
    expect(convertColor("rgb(59 130 246)", "hex")).toBe("#3b82f6");
    expect(convertColor("#ff0000", "hsl")).toBe("hsl(0 100% 50%)");
    expect(convertColor("hsl(0 100% 50%)", "hex")).toBe("#ff0000");
  });

  test("returns null for unparseable input", () => {
    expect(convertColor("red", "hex")).toBeNull();
  });

  test("round trips every format without losing the 8 bit color", () => {
    const samples = [
      "#000000",
      "#ffffff",
      "#3b82f6",
      "#7f7f7f",
      "#012345",
      "#fedcba",
      "#ff00ff",
      "#00ffff",
    ];
    for (const sample of samples) {
      for (const format of formats) {
        const converted = convertColor(sample, format);
        expect(converted).not.toBeNull();
        expect(convertColor(converted!, "hex")).toBe(sample);
      }
    }
  });

  test("round trips alpha through every format", () => {
    for (const format of formats) {
      const converted = convertColor("#3b82f680", format);
      expect(converted).not.toBeNull();
      expect(convertColor(converted!, "hex")).toBe("#3b82f680");
    }
  });

  test("canonicalizes non canonical input of the same format", () => {
    expect(convertColor("#F00", "hex")).toBe("#ff0000");
    expect(convertColor("rgba(255, 0, 0, 1)", "rgb")).toBe("rgb(255 0 0)");
    expect(convertColor("hsla(0, 100%, 50%, 1)", "hsl")).toBe(
      "hsl(0 100% 50%)",
    );
  });
});

describe("oklch conversion", () => {
  test("round trips through Oklch for every 8 bit grey", () => {
    for (let channel = 0; channel <= 255; channel++) {
      const { l, c, h } = rgbToOklch(channel, channel, channel);
      const back = oklchToRgb(l, c, h);
      expect(Math.round(back.r)).toBe(channel);
      expect(Math.round(back.g)).toBe(channel);
      expect(Math.round(back.b)).toBe(channel);
    }
  });

  test("achromatic colors report hue 0 rather than atan2 noise", () => {
    expect(rgbToOklch(255, 255, 255).h).toBe(0);
    expect(rgbToOklch(0, 0, 0).h).toBe(0);
    expect(rgbToOklch(128, 128, 128).h).toBe(0);
  });
});

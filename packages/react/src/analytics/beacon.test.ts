import { AnalyticsBeacon } from "@valbuild/shared/internal";
import {
  buildBeacons,
  deviceOf,
  MAX_PATHS_PER_BEACON,
  referrerHostOf,
  routeOf,
  utmOf,
} from "./beacon";

describe("the page view's own fields", () => {
  test("device class by viewport width", () => {
    expect(deviceOf(390)).toBe("phone");
    expect(deviceOf(639)).toBe("phone");
    expect(deviceOf(640)).toBe("tablet");
    expect(deviceOf(1023)).toBe("tablet");
    expect(deviceOf(1024)).toBe("desktop");
  });

  test("the referrer is another site's host, and nothing else of it", () => {
    expect(
      referrerHostOf(
        "https://news.ycombinator.com/item?id=1&user=me",
        "acme.no",
      ),
    ).toBe("news.ycombinator.com");
    expect(referrerHostOf("https://acme.no/blog", "acme.no")).toBeUndefined();
    expect(referrerHostOf("", "acme.no")).toBeUndefined();
    expect(referrerHostOf("not a url", "acme.no")).toBeUndefined();
  });

  test("only the three utm parameters are read, and cut to length", () => {
    expect(
      utmOf(
        "?utm_source=newsletter&utm_medium=email&utm_campaign=oct&email=a@b.no",
      ),
    ).toEqual({ source: "newsletter", medium: "email", campaign: "oct" });
    expect(utmOf("?email=a@b.no")).toBeUndefined();
    expect(utmOf(`?utm_source=${"x".repeat(500)}`)?.source).toHaveLength(100);
  });

  test("the route is the pathname, cut to length", () => {
    expect(routeOf("/blogs/a")).toBe("/blogs/a");
    expect(routeOf("/" + "a".repeat(1000))).toHaveLength(512);
  });
});

describe("buildBeacons", () => {
  test("groups paths by module, and puts the page view in the first", () => {
    const beacons = buildBeacons({
      route: "/blogs/a",
      cv: "c1",
      view: { device: "desktop", ref: "google.com" },
      rendered: [
        '/content/blog.val.ts?p="a"."title"',
        '/content/blog.val.ts?p="a"."body"',
        "/content/footer.val.ts",
      ],
      viewed: ['/content/blog.val.ts?p="a"."title"'],
    });
    expect(beacons).toEqual([
      {
        v: 1,
        route: "/blogs/a",
        cv: "c1",
        view: { device: "desktop", ref: "google.com" },
        rendered: {
          "/content/blog.val.ts": ['"a"."title"', '"a"."body"'],
          "/content/footer.val.ts": [""],
        },
        viewed: { "/content/blog.val.ts": ['"a"."title"'] },
      },
    ]);
  });

  test("sends the page view alone when nothing has been counted yet", () => {
    expect(
      buildBeacons({
        route: "/",
        view: { device: "phone" },
        rendered: [],
        viewed: [],
      }),
    ).toEqual([
      { v: 1, route: "/", view: { device: "phone" }, rendered: {}, viewed: {} },
    ]);
  });

  test("sends nothing when there is nothing to say", () => {
    expect(buildBeacons({ route: "/", rendered: [], viewed: [] })).toEqual([]);
  });

  test("splits at the per-beacon limit, with the page view in the first only", () => {
    const paths = Array.from(
      { length: MAX_PATHS_PER_BEACON + 1 },
      (_, i) => `/content/list.val.ts?p=${i}`,
    );
    const beacons = buildBeacons({
      route: "/",
      view: { device: "desktop" },
      rendered: paths,
      viewed: [],
    });
    expect(beacons).toHaveLength(2);
    expect(beacons[0].view).toEqual({ device: "desktop" });
    expect(beacons[1].view).toBeUndefined();
    expect(beacons[0].rendered["/content/list.val.ts"]).toHaveLength(
      MAX_PATHS_PER_BEACON,
    );
    expect(beacons[1].rendered["/content/list.val.ts"]).toEqual(["200"]);
  });

  test("what it builds is what the server parses", () => {
    const [beacon] = buildBeacons({
      route: "/blogs/a",
      cv: "c1",
      view: {
        device: "tablet",
        ref: "google.com",
        utm: { source: "newsletter" },
      },
      rendered: ['/content/blog.val.ts?p="a"'],
      viewed: ['/content/blog.val.ts?p="a"'],
    });
    const parsed = AnalyticsBeacon.safeParse(
      JSON.parse(JSON.stringify(beacon)),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(beacon);
  });
});

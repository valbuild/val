import { relativeLocalDate } from "./relativeLocalDate";

describe("relativeLocalDate", () => {
  test("should return 'just now' when the difference is less than a minute", () => {
    const now = new Date();
    const date = new Date(now.getTime() - 5000).toISOString();
    expect(relativeLocalDate(now, date)).toBe("just now");
  });

  test("should return 'yesterday' when the difference is less than a day", () => {
    const now = new Date();
    const date = new Date(now.getTime() - 1000 * 60 * 60 * 24).toISOString();
    expect(relativeLocalDate(now, date)).toBe("yesterday");
  });

  test("should return 'Xm ago' when the difference is less than an hour", () => {
    const now = new Date();
    const date = new Date(now.getTime() - 1000 * 60 * 30).toISOString();
    expect(relativeLocalDate(now, date)).toBe("30m ago");
  });

  test("should return 'Xh ago' when the difference is less than a day", () => {
    const now = new Date();
    const date = new Date(now.getTime() - 1000 * 60 * 60 * 6).toISOString();
    expect(relativeLocalDate(now, date)).toBe("6h ago");
  });

  test("should return 'Xd ago' when the difference is more than a day", () => {
    const now = new Date();
    const date = new Date(
      now.getTime() - 1000 * 60 * 60 * 24 * 3,
    ).toISOString();
    expect(relativeLocalDate(now, date)).toBe("3d ago");
  });

  test("should return 'Xm ago' when the difference is more than a month", () => {
    const now = new Date(2024, 2, 1); // NOTE: we can't use the current Date since it will fail every march since february is not 30 days and we use 30 days to approximate a month
    const date = new Date(
      now.getFullYear(),
      now.getMonth() - 2,
      now.getDate(),
    ).toISOString();
    expect(relativeLocalDate(now, date)).toBe("2mo ago");
  });
});

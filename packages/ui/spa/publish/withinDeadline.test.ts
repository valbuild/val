import { isTransientPublishError } from "./publishClient";
import { withinDeadline } from "./withinDeadline";

test("an answer in time is the answer", async () => {
  await expect(withinDeadline(Promise.resolve("ok"), 50)).resolves.toBe("ok");
});

test("no answer in time is no answer at all: one to ask again", async () => {
  const error = await withinDeadline(new Promise(() => undefined), 5).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  expect(isTransientPublishError(error)).toBe(true);
});

test("a refusal in time is the refusal", async () => {
  await expect(
    withinDeadline(Promise.reject(new Error("refused")), 50),
  ).rejects.toThrow("refused");
});

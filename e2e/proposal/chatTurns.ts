import { expect, type Page } from "@playwright/test";
import type { Mock } from "../http/httpMode";

/**
 * Whether the chat on screen keeps up with the turn the content service is
 * running in it. The mock plays turns under the service's rules (one turn
 * per chat, held until it is answered, stopped or its socket closes), and
 * reports them in `runningTurns`, so a test can hold the Studio to them.
 */

/** The chat whose id the address names: the one on screen. */
export function chatOnScreen(page: Page): string | null {
  return new URL(page.url()).searchParams.get("session");
}

/** The turn the service is running in the chat on screen, if any. */
export async function runningOnScreen(page: Page, mock: Mock) {
  const session = chatOnScreen(page);
  if (session === null) return null;
  const { runningTurns } = await mock.aiState();
  return runningTurns.find((turn) => turn.sessionId === session) ?? null;
}

/**
 * The rule: while the service runs a turn in the chat on screen, the chat
 * offers to stop it, and a call that waits on the person is on screen to be
 * answered. Polled, since the two sides settle a moment apart; a chat that
 * lost its turn never settles.
 */
export async function expectTurnShown(page: Page, mock: Mock): Promise<void> {
  const studio = page.locator("#val-shadow-root");
  let why = "";
  await expect
    .poll(
      async () => {
        const running = await runningOnScreen(page, mock);
        if (running === null) return true;
        const stop = await studio
          .getByRole("button", { name: "Stop generating" })
          .isVisible();
        if (!stop) {
          why = `the service is running a turn in the chat on screen (waiting on ${running.waitingOn?.name ?? "the model"}), and the chat offers no way to stop it`;
          return false;
        }
        if (running.waitingOn?.name === "request_code_mode") {
          const card = await studio
            .getByRole("group", { name: "The assistant asks for code mode" })
            .isVisible();
          if (!card) {
            why =
              "the turn waits on the person to turn on code mode, and the card that asks them is not on screen";
            return false;
          }
        }
        return true;
      },
      { timeout: 15_000, message: "" },
    )
    .toBe(true)
    .catch((error: unknown) => {
      throw new Error(`The chat lost its running turn: ${why}`, {
        cause: error,
      });
    });
}

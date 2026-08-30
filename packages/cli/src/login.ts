import pc from "picocolors";
import {
  awaitValLoginConfirmation,
  persistPersonalAccessToken,
  startValLogin,
  ValLoginError,
} from "@valbuild/server";

/**
 * Terminal wrapper around the login device flow in `@valbuild/server`.
 * The flow itself (polling, token persistence) is shared with
 * `@valbuild/language-server`.
 */
export async function login(options: { root?: string }) {
  try {
    console.log(pc.cyan("\nStarting login process...\n"));

    const { nonce, url } = await startValLogin();

    console.log(pc.green("Open the following URL in your browser to log in:"));
    console.log(pc.underline(pc.blue(url)));
    console.log(pc.dim("\nWaiting for login confirmation...\n"));

    const result = await awaitValLoginConfirmation(nonce);

    const filePath = persistPersonalAccessToken(
      options.root || process.cwd(),
      result,
    );
    console.log(
      pc.green(
        `Token for ${pc.cyan(
          result.profile.email,
        )} saved to ${pc.cyan(filePath)}`,
      ),
    );
  } catch (error) {
    if (error instanceof ValLoginError) {
      console.error(pc.red(error.message), error.details ?? "");
      process.exit(1);
    }
    console.error(
      pc.red(
        "An error occurred during the login process. Check your internet connection. Details:",
      ),
      error instanceof Error ? error.message : JSON.stringify(error, null, 2),
    );
    process.exit(1);
  }
}

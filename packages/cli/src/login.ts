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
 *
 * The user code is printed and the device code is not: the code on screen is
 * the one to compare against the browser, and it cannot be used to collect a
 * token on its own.
 */
export async function login(options: { root?: string }) {
  try {
    console.log(pc.cyan("\nStarting login process...\n"));

    const authorization = await startValLogin();

    console.log(
      pc.green("Open this URL in your browser to approve the login:"),
    );
    console.log(pc.underline(pc.blue(authorization.verificationUriComplete)));
    console.log(
      `\nThen check that it shows this code: ${pc.bold(
        pc.cyan(authorization.userCode),
      )}`,
    );
    console.log(
      pc.dim(
        "\nApprove the login in the browser. Waiting for confirmation...\n",
      ),
    );

    const result = await awaitValLoginConfirmation(authorization);

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

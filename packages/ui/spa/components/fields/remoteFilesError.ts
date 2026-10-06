/**
 * Why remote files are unavailable, in a sentence for an editor.
 *
 * Its own module so that what shows it -- the image and video fields, and
 * `RemoteFilesNotice` above the editor -- can import it without importing
 * each other.
 */
export function getRemoteFilesError(
  reason:
    | "unknown-error"
    | "project-not-configured"
    | "api-key-missing"
    | "pat-error"
    | "error-could-not-get-settings"
    | "no-internet-connection"
    | "unauthorized-personal-access-token-error"
    | "unauthorized",
) {
  switch (reason) {
    case "api-key-missing":
      // Not "production mode": every server that is not local dev answers this,
      // and a PAT cannot substitute for it -- a PAT is read from a file in a
      // working directory, which such a server does not have. Saying so stops
      // the reader hunting for the directory to run `val login` in.
      return "To upload remote files and images, this server needs the VAL_API_KEY env set. A personal access token cannot be used here: it is read from a file in a working directory, and this server has none. Contact a developer to fix this issue.";
    case "error-could-not-get-settings":
      return `Could not get settings from the Val remote server. This means that updating or changing certain types of files and images might not work. Check your internet connection and try again. (Error code: ${reason})`;
    case "no-internet-connection":
      return "Cannot upload remote files and images, since this requires an internet connection";
    case "pat-error":
      return "Val is running in development mode. To upload remote files and images, you must either login (by running `npx -p @valbuild/cli val login`) or set the VAL_API_KEY env";
    case "project-not-configured":
      return "Project is not configured. To upload remote files and images, the val.config must contain a project id that is obtained from https://admin.val.build. Contact a developer to fix this issue.";
    case "unauthorized":
      return "Cannot upload remote files and images since you are unauthorized";
    case "unauthorized-personal-access-token-error":
      return "Cannot upload remote files and images since the personal access token is unauthorized. Try to login again by running `npx -p @valbuild/cli val login`";
    case "unknown-error":
      return "Unknown error";
    default: {
      const exhaustiveCheck: never = reason;
      return exhaustiveCheck;
    }
  }
}

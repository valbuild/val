/** How long `ValProvider` waits before asking `/remote/settings` again. */
export const REMOTE_SETTINGS_RETRY_MS = 5000;
/** How many times `ValProvider` asks `/remote/settings` in all. */
export const REMOTE_SETTINGS_MAX_ATTEMPTS = 10;

/**
 * Whether a failed `/remote/settings` is worth asking again.
 *
 * Only when asking again can give a different answer: the network failed
 * (`null`) or the server did (5xx). A 401 means the person is signed out, and
 * the Studio is already showing them the login dialog; signing in reloads the
 * page, so nothing here has to notice. A 400 is the project's own settings,
 * which no retry changes. Both used to be asked again every five seconds, by a
 * signed-out tab sitting on the login dialog.
 *
 * @param status what the last attempt answered, `null` for no answer
 * @param attempts how many attempts have been made, the last one included
 */
export function shouldRetryRemoteSettings(
  status: number | null,
  attempts: number,
): boolean {
  if (attempts >= REMOTE_SETTINGS_MAX_ATTEMPTS) return false;
  return status === null || status >= 500;
}

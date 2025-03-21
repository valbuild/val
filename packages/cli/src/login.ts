import pc from "picocolors";
import fs from "fs";
import path from "path";
import { getPersonalAccessTokenPath } from "@valbuild/server";

const host = process.env.VAL_BUILD_URL || "https://app.val.build";

export async function login(options: { root?: string }) {
  try {
    console.log(pc.cyan("\nStarting login process...\n"));

    // Step 1: Initiate login and get token and URL
    const response = await fetch(`${host}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    let token;
    let url;
    if (!response.headers.get("content-type")?.includes("application/json")) {
      const text = await response.text();
      console.error(
        pc.red(
          "Unexpected failure while trying to login (content type was not JSON). Server response:",
        ),
        text || "<empty>",
      );
      process.exit(1);
    }
    const json = await response.json();
    if (json) {
      token = json.nonce;
      url = json.url;
    }
    if (!token || !url) {
      console.error(pc.red("Unexpected response from the server."), json);
      process.exit(1);
    }

    console.log(pc.green("Open the following URL in your browser to log in:"));
    console.log(pc.underline(pc.blue(url)));
    console.log(pc.dim("\nWaiting for login confirmation...\n"));

    // Step 2: Poll for login confirmation
    const result = await pollForConfirmation(token);

    // Step 3: Save the token
    const filePath = getPersonalAccessTokenPath(options.root || process.cwd());
    saveToken(result, filePath);
  } catch (error) {
    console.error(
      pc.red(
        "An error occurred during the login process. Check your internet connection. Details:",
      ),
      error instanceof Error ? error.message : JSON.stringify(error, null, 2),
    );
    process.exit(1);
  }
}

const MAX_DURATION = 5 * 60 * 1000; // 5 minutes
async function pollForConfirmation(token: string): Promise<{
  profile: { username: string };
  pat: string;
}> {
  const start = Date.now();
  while (Date.now() - start < MAX_DURATION) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await fetch(
      `${host}/api/login?token=${token}&consume=true`,
    );
    if (response.status === 500) {
      console.error(pc.red("An error occurred on the server."));
      process.exit(1);
    }
    if (response.status === 200) {
      const json = await response.json();
      if (json) {
        if (
          typeof json.profile.username === "string" &&
          typeof json.pat === "string"
        ) {
          return json;
        } else {
          console.error(pc.red("Unexpected response from the server."));
          process.exit(1);
        }
      }
    }
  }
  console.error(pc.red("Login confirmation timed out."));
  process.exit(1);
}

function saveToken(
  result: {
    profile: { username: string };
    pat: string;
  },
  filePath: string,
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  console.log(
    pc.green(
      `Token for ${pc.cyan(
        result.profile.username,
      )} saved to ${pc.cyan(filePath)}`,
    ),
  );
}

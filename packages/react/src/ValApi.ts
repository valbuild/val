import { SerializedModule } from "@valbuild/lib";
import { PatchJSON } from "@valbuild/lib/patch";

export class ValApi {
  constructor(readonly host: string) {}

  async getModule(sourcePath: string): Promise<SerializedModule> {
    const res = await fetch(`${this.host}/ids${sourcePath}`);
    if (res.ok) {
      const serializedVal = await res.json(); // TODO: validate
      return serializedVal;
    } else {
      throw Error(
        `Failed to get content of module "${sourcePath}". Status: ${
          res.status
        }. Error: ${await res.text()}`
      );
    }
  }

  async patchModuleContent(
    moduleId: string,
    patch: PatchJSON
  ): Promise<SerializedModule> {
    const res = await fetch(`${this.host}/ids${moduleId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json-patch+json",
      },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      return res.json(); // TODO: validate
    } else {
      throw Error(
        `Failed to patch content of module "${moduleId}". Error: ${await res.text()}`
      );
    }
  }

  async commit(): Promise<void> {
    const res = await fetch(`${this.host}/commit`, {
      method: "POST",
    });
    if (res.ok) {
      return;
    } else {
      throw Error(`Failed to commit. Error: ${await res.text()}`);
    }
  }

  getSession() {
    return fetch(`${this.host}/session`);
  }

  loginUrl() {
    return `${this.host}/authorize?redirect_to=${encodeURIComponent(
      location.href
    )}`;
  }

  logout() {
    return fetch(`${this.host}/logout`);
  }
}

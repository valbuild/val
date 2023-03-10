import { SerializedVal } from "@valbuild/lib";
import { Operation } from "fast-json-patch";

export class ValApi {
  constructor(readonly host: string) {}

  async getModule(moduleId: string): Promise<SerializedVal> {
    const res = await fetch(`${this.host}/ids${moduleId}`);
    if (res.ok) {
      const serializedVal = await res.json(); // TODO: validate
      return serializedVal;
    } else {
      throw Error(
        `Failed to get content of module "${moduleId}". Status: ${
          res.status
        }. Error: ${await res.text()}`
      );
    }
  }

  async patchModuleContent(
    moduleId: string,
    patch: Operation[]
  ): Promise<void> {
    const res = await fetch(`${this.host}/ids${moduleId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json-patch+json",
      },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      return;
    } else {
      throw Error(
        `Failed to patch content of module "${moduleId}". Error: ${await res.text()}`
      );
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

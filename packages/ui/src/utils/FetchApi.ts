export class FetchApi {
  constructor(public host: string) {}

  getSession(): Promise<Response> {
    return fetch(`${this.host}/session`);
  }

  getTree(
    patch: boolean,
    includeSchema: boolean,
    includeSource: boolean,
    treePath = "/"
  ): Promise<Response> {
    const params = new URLSearchParams();
    params.set("patch", patch.toString());
    params.set("schema", includeSchema.toString());
    params.set("source", includeSource.toString());
    return fetch(`${this.host}/tree/~${treePath}?${params.toString()}`);
  }
}

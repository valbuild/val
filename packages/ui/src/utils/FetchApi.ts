export class FetchApi {
  constructor(public host: string) {}

  getSession(): Promise<Response> {
    return fetch(`${this.host}/session`);
  }
}

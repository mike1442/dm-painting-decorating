/** Minimal framework adapter: tests execute the real middleware and HTTP code. */
export class NextResponse extends Response {
  cookies = {
    set: (name: string, value: string) => { this.headers.append("Set-Cookie", `${name}=${value}`); },
    delete: (name: string) => { this.headers.append("Set-Cookie", `${name}=; Max-Age=0`); },
  };

  static next() {
    return new NextResponse(null, { headers: { "x-middleware-next": "1" } });
  }

  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), init);
  }

  static redirect(url: string | URL, status = 307) {
    return new NextResponse(null, { status, headers: { Location: String(url) } });
  }
}

export function cookies(): never {
  throw new Error("These boundary tests must not read a Next.js request cookie context.");
}

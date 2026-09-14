/**
 * Which IP addresses this server may open a connection to.
 *
 * The link check makes outbound requests to addresses an editor supplies,
 * which is the definition of SSRF: without this, "check my external links"
 * is a button that turns the app's server into a probe for whatever is
 * reachable from inside the network it runs in - a database on a private
 * subnet, an admin panel on localhost, and on every major cloud the instance
 * metadata service on 169.254.169.254, which hands out credentials.
 *
 * So the rule is a DENY LIST of address ranges rather than an allow list of
 * hostnames: an editor is allowed to check any real site on the internet, and
 * nothing else. It is applied to the RESOLVED address, in the lookup the
 * socket then connects to - a public name is free to resolve to 127.0.0.1,
 * and checking the name would catch none of it.
 */

/** Why an address may not be connected to. Reported, not just counted. */
export type BlockedReason =
  | "unspecified"
  | "loopback"
  | "private"
  | "link-local"
  | "unique-local"
  | "multicast"
  | "reserved"
  | "unparseable";

const REASON_TEXT: Record<BlockedReason, string> = {
  unspecified: "an unspecified address",
  loopback: "a loopback address",
  private: "a private address",
  "link-local": "a link-local address",
  "unique-local": "a unique local address",
  multicast: "a multicast address",
  reserved: "a reserved address",
  unparseable: "an address that could not be read",
};

export function describeBlocked(reason: BlockedReason): string {
  return REASON_TEXT[reason];
}

/** `null` when the address is a public one this server may talk to. */
export function blockedAddressReason(address: string): BlockedReason | null {
  // A scope/zone id (`fe80::1%eth0`) is not part of the address, and leaving
  // it on would make the address unparseable — which fails closed, but for the
  // wrong reason and with the wrong message.
  const bare = address.split("%")[0];
  const v4 = parseIPv4(bare);
  if (v4 !== null) {
    return blockedIPv4(v4);
  }
  const v6 = parseIPv6(bare);
  if (v6 !== null) {
    return blockedIPv6(v6);
  }
  // Fail closed. Anything that reaches here is not something `dns.lookup`
  // produced, and connecting to an address this cannot read is exactly the
  // case a deny list must not wave through.
  return "unparseable";
}

function parseIPv4(text: string): [number, number, number, number] | null {
  const parts = text.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    // Deliberately strict: `010` is octal to `inet_aton` and decimal to
    // `Number`, and `1e2` parses as 100. A resolver never produces either, so
    // anything that is not plain digits is not an address.
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value > 255) {
      return null;
    }
    octets.push(value);
  }
  return [octets[0], octets[1], octets[2], octets[3]];
}

/** Eight hextets, with `::` expanded and a trailing IPv4 form accepted. */
function parseIPv6(text: string): number[] | null {
  if (!text.includes(":")) {
    return null;
  }
  // A trailing dotted quad is rewritten into the two hextets it IS, before
  // anything else looks at the string. Splitting the address around it
  // instead means handling a `::` that the split lands inside - which is
  // exactly where `::127.0.0.1` went wrong.
  let normalized = text;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (v4 === null) {
      return null;
    }
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    normalized = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const doubleColon = normalized.indexOf("::");
  if (doubleColon !== normalized.lastIndexOf("::")) {
    return null;
  }
  let groups: string[];
  if (doubleColon === -1) {
    groups = normalized.split(":");
    if (groups.length !== 8) {
      return null;
    }
  } else {
    const left = normalized.slice(0, doubleColon);
    const right = normalized.slice(doubleColon + 2);
    const before = left === "" ? [] : left.split(":");
    const after = right === "" ? [] : right.split(":");
    if (before.length + after.length > 7) {
      // `::` stands for AT LEAST one group of zeros, so eight written groups
      // beside it is one too many.
      return null;
    }
    groups = [
      ...before,
      ...new Array<string>(8 - before.length - after.length).fill("0"),
      ...after,
    ];
  }
  const hextets: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null;
    }
    hextets.push(parseInt(group, 16));
  }
  return hextets.length === 8 ? hextets : null;
}

function blockedIPv4(
  octets: [number, number, number, number],
): BlockedReason | null {
  const [a, b, c] = octets;
  if (a === 0) return "unspecified"; // 0.0.0.0/8
  if (a === 10) return "private"; // 10.0.0.0/8
  if (a === 127) return "loopback"; // 127.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return "private"; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return "link-local"; // 169.254.0.0/16 — cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return "private"; // 172.16.0.0/12
  if (a === 192 && b === 168) return "private"; // 192.168.0.0/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return "reserved"; // 192.0.0.0/24, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return "reserved"; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return "reserved"; // benchmarking
  if (a === 198 && b === 51 && c === 100) return "reserved"; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return "reserved"; // TEST-NET-3
  if (a >= 240) return "reserved"; // 240.0.0.0/4, incl. 255.255.255.255
  if (a >= 224) return "multicast"; // 224.0.0.0/4
  return null;
}

function blockedIPv6(h: number[]): BlockedReason | null {
  const leadingZeros =
    h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
  if (leadingZeros && h[5] === 0xffff) {
    // ::ffff:0:0/96 — an IPv4 address wearing an IPv6 hat, and the form a
    // dual-stack resolver hands back. Judged as the IPv4 address it is, or
    // this whole list would be one `::ffff:` away from being bypassed.
    return blockedIPv4(v4Of(h[6], h[7]));
  }
  if (leadingZeros && h[5] === 0) {
    // ::/128 unspecified, ::1/128 loopback, and the deprecated
    // IPv4-compatible ::a.b.c.d — all of which are local or nothing.
    if (h[6] === 0 && h[7] === 0) return "unspecified";
    if (h[6] === 0 && h[7] === 1) return "loopback";
    return blockedIPv4(v4Of(h[6], h[7])) ?? "reserved";
  }
  if (h[0] === 0x64 && h[1] === 0xff9b) return "reserved"; // NAT64
  if (h[0] === 0x100 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
    return "reserved"; // 100::/64 discard-only
  }
  if (h[0] === 0x2001 && h[1] === 0x0db8) return "reserved"; // documentation
  if ((h[0] & 0xfe00) === 0xfc00) return "unique-local"; // fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return "link-local"; // fe80::/10
  if ((h[0] & 0xff00) === 0xff00) return "multicast"; // ff00::/8
  return null;
}

function v4Of(high: number, low: number): [number, number, number, number] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

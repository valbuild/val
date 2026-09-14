import { blockedAddressReason, describeBlocked } from "./addressGuard";

/**
 * The deny list, address by address.
 *
 * This is the whole security boundary of the link check: everything else in
 * that feature is presentation. A hole here is a request the app's server
 * makes, on behalf of anyone who can edit content, to something only the
 * server can reach — the cloud metadata service being the one that hands out
 * credentials for doing it.
 *
 * So the table is written out rather than generated, and includes the forms
 * that are the SAME address wearing a different hat: an IPv4-mapped IPv6
 * address, the long spelling of `::1`, a zone id on a link-local address.
 */
describe("addresses this server may not connect to", () => {
  test.each([
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "unspecified"],
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["127.0.0.1", "loopback"],
    ["127.1.2.3", "loopback"],
    ["100.64.0.1", "private"],
    ["100.127.255.255", "private"],
    // The one that matters most: AWS, GCP and Azure all serve credentials here.
    ["169.254.169.254", "link-local"],
    ["169.254.0.1", "link-local"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.0.1", "private"],
    ["192.168.255.255", "private"],
    ["192.0.0.1", "reserved"],
    ["192.0.2.1", "reserved"],
    ["192.88.99.1", "reserved"],
    ["198.18.0.1", "reserved"],
    ["198.19.255.255", "reserved"],
    ["198.51.100.1", "reserved"],
    ["203.0.113.1", "reserved"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.255", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "reserved"],
  ])("%s is %s", (address, reason) => {
    expect(blockedAddressReason(address)).toBe(reason);
  });

  test.each([
    ["::", "unspecified"],
    ["0:0:0:0:0:0:0:0", "unspecified"],
    ["::1", "loopback"],
    // The same address spelled out, which a deny list matching on text would
    // miss entirely.
    ["0:0:0:0:0:0:0:1", "loopback"],
    ["fc00::1", "unique-local"],
    ["fd12:3456::1", "unique-local"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "reserved"],
    ["64:ff9b::1.2.3.4", "reserved"],
    ["100::1", "reserved"],
  ])("%s is %s", (address, reason) => {
    expect(blockedAddressReason(address)).toBe(reason);
  });

  test.each([
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:10.0.0.1", "private"],
    ["::ffff:169.254.169.254", "link-local"],
    ["::ffff:192.168.1.1", "private"],
    // The hex spelling of the same thing. `::ffff:7f00:1` IS 127.0.0.1.
    ["::ffff:7f00:1", "loopback"],
    ["0:0:0:0:0:ffff:a9fe:a9fe", "link-local"],
    // Deprecated IPv4-compatible form.
    ["::127.0.0.1", "loopback"],
  ])("%s is the IPv4 address it wraps: %s", (address, reason) => {
    expect(blockedAddressReason(address)).toBe(reason);
  });

  test("a zone id does not smuggle a link-local address past", () => {
    expect(blockedAddressReason("fe80::1%eth0")).toBe("link-local");
  });

  test.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "192.0.1.1",
    "192.0.3.1",
    "169.253.0.1",
    "169.255.0.1",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2001:db9::1",
    "fbff::1",
    "fec0::1",
    "::ffff:8.8.8.8",
  ])("%s is a public address and is allowed", (address) => {
    expect(blockedAddressReason(address)).toBeNull();
  });

  /**
   * Anything the guard cannot read is refused rather than allowed. A deny list
   * that returns "fine" for input it did not understand is not a deny list.
   */
  test.each([
    "",
    "not an address",
    "999.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "0x7f.0.0.1",
    // Octal, which `inet_aton` reads as 127.0.0.1 and `Number` as 10.0.0.1.
    "0177.0.0.1",
    "1e2.0.0.1",
    "::fffff:1.2.3.4",
    "1::2::3",
    "gggg::1",
  ])("%s cannot be read, so it is refused", (address) => {
    expect(blockedAddressReason(address)).toBe("unparseable");
  });

  test("every reason has something to say", () => {
    const reasons = [
      "unspecified",
      "loopback",
      "private",
      "link-local",
      "unique-local",
      "multicast",
      "reserved",
      "unparseable",
    ] as const;
    for (const reason of reasons) {
      expect(describeBlocked(reason).length).toBeGreaterThan(0);
    }
  });
});

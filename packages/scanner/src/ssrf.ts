import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";

export class BlockedUrlError extends Error {
  code = "blocked_url" as const;
}

type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;

const IPV4_BLOCKS = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const;

const IPV6_BLOCKS = [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]
] as const;

export function isBlockedAddress(input: string): boolean {
  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try { address = ipaddr.parse(input); } catch { return true; }
  if (address.kind() === "ipv6" && (address as ipaddr.IPv6).isIPv4MappedAddress()) {
    address = (address as ipaddr.IPv6).toIPv4Address();
  }
  const ranges = address.kind() === "ipv4" ? IPV4_BLOCKS : IPV6_BLOCKS;
  return ranges.some(([base, prefix]) => address.match(ipaddr.parse(base), prefix));
}

export class SsrfGuard {
  private readonly cache = new Map<string, Promise<{ address: string; family: number }[]>>();
  constructor(private readonly lookup: Lookup = async host => dns.lookup(host, { all: true })) {}

  async assertSafe(input: string | URL): Promise<void> {
    const url = typeof input === "string" ? new URL(input) : input;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (ipaddr.isValid(host)) throw new BlockedUrlError("Literal IP hosts are not allowed");
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
      throw new BlockedUrlError("Local hosts are not allowed");
    }
    let addresses: { address: string; family: number }[];
    try {
      const pending = this.cache.get(host) ?? this.lookup(host);
      this.cache.set(host, pending);
      addresses = await pending;
    } catch {
      throw new BlockedUrlError("Host could not be resolved safely");
    }
    if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
      throw new BlockedUrlError("Host resolves to a blocked network");
    }
  }
}

export async function assertSafeUrl(input: string, lookup?: Lookup): Promise<void> {
  await new SsrfGuard(lookup).assertSafe(input);
}

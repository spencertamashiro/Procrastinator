// Where outgoing requests may go. Every request names one of these policies, and the
// transport (net.ts) checks the first address and every redirect against it:
//
// - credentialed: carries a token or secret (Canvas, Google). Redirects are followed only
//   within the same origin, so the secret is never handed to another server.
// - icloud: carries the Apple app-specific password. Every request and every redirect must
//   stay on Apple's iCloud servers, including addresses that iCloud's own replies point to.
// - public: carries nothing secret except perhaps its own address (calendar feeds,
//   weather). Redirects may change host, but an address on the internet may not redirect
//   into the user's own computer or local network.
//
// For all of them: https only, and never a user name or password inside an address.

export type Egress = 'credentialed' | 'icloud' | 'public';

export const MAX_REDIRECTS = 5;

const ICLOUD_HOST = /(^|\.)icloud\.com(\.cn)?$/i;

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function privateV4([a, b]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/**
 * True for names and addresses that point at this computer or a local network rather
 * than the public internet. Works on URL hostnames, which the URL parser has already
 * normalised (decimal or hex IPv4 forms become dotted quads, IPv6 is lower-case in brackets).
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::' || v6 === '::1') return true;
    const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(v6);
    if (mapped) {
      if (mapped[1]) return privateV4(ipv4(mapped[1]) ?? [0, 0]);
      const hi = parseInt(mapped[2], 16);
      return privateV4([hi >> 8, hi & 255]);
    }
    return /^(f[cd]|fe[89ab]|ff)/.test(v6); // unique-local, link-local, multicast
  }
  const v4 = ipv4(host);
  if (v4) return privateV4(v4);
  if (!host.includes('.')) return true; // single-label names only resolve on a local network
  return /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/.test(host);
}

/** Why a request to `url` under `egress` must not be made, or null when it may. */
export function blockReason(egress: Egress, url: URL): string | null {
  if (url.protocol !== 'https:') return 'Only secure (https) addresses are used.';
  if (url.username || url.password) return 'Addresses with a user name or password in them are not used.';
  if (egress === 'icloud' && !ICLOUD_HOST.test(url.hostname)) {
    return `Blocked a request to ${url.hostname}: your Apple password is only ever sent to iCloud.`;
  }
  return null;
}

/**
 * Why a redirect from `current` to `target` must not be followed, or null when it may.
 * `original` is the address first requested; `hop` counts redirects so far, starting at 1.
 */
export function redirectBlockReason(egress: Egress, original: URL, target: URL, hop: number): string | null {
  if (hop > MAX_REDIRECTS) return 'The service redirected too many times.';
  if (target.protocol !== 'https:') return `The service redirected to an insecure address (${target.host}), which is not followed.`;
  const basic = blockReason(egress, target);
  if (basic) return basic;
  if (egress === 'credentialed' && target.origin !== original.origin) {
    return `The service redirected to ${target.host}. To keep your sign-in private it was not followed; if that is the right address, connect with it instead.`;
  }
  if (egress === 'public' && isPrivateHost(target.hostname) && !isPrivateHost(original.hostname)) {
    return `The address redirected into your local network (${target.hostname}), which is blocked.`;
  }
  return null;
}

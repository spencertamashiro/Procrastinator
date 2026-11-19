import { describe, it, expect, vi } from 'vitest';
import { isPrivateHost, blockReason, redirectBlockReason, MAX_REDIRECTS, type Egress } from '../src/main/services/egress';

const policies: Egress[] = ['credentialed', 'icloud', 'public'];
const url = (host: string) => new URL(`https://${host}/calendar`);

describe('isPrivateHost', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '0.0.0.0', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '198.18.0.1', '198.19.255.255',
    '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '[::1]', '[::]', '[fc00::1]', '[fd12::1]', '[fe80::1]', '[ff02::1]',
    '[::ffff:127.0.0.1]', '[::ffff:10.0.0.1]', '2130706433', '0x7f.1', '0177.0.0.1',
    'localhost', 'localhost.', 'foo.localhost', 'printer.local', 'corp.internal',
    'x.lan', 'x.home.arpa', 'x.intranet', 'printer',
  ])('recognises %s as private after URL normalisation', (host) => {
    expect(isPrivateHost(url(host).hostname)).toBe(true);
  });

  it.each([
    '8.8.8.8', '172.32.0.1', '172.15.255.255', '100.128.0.1', '100.63.255.255',
    '192.169.0.1', '11.0.0.1', '[2606:4700::1111]', '[::ffff:8.8.8.8]',
    'example.com', 'calendar.google.com', 'p01-caldav.icloud.com',
  ])('recognises %s as public', (host) => {
    expect(isPrivateHost(url(host).hostname)).toBe(false);
  });
});

describe('blockReason', () => {
  it.each(policies)('blocks http under %s', (policy) => {
    expect(blockReason(policy, new URL('http://p01-caldav.icloud.com/'))).toMatch(/https/);
  });
  it.each(policies)('allows https under %s', (policy) => {
    expect(blockReason(policy, url('p01-caldav.icloud.com'))).toBeNull();
  });
  it.each(policies.flatMap((policy) => ['user@', ':secret@', 'user:secret@'].map((auth) => ({ policy, auth }))))(
    'blocks embedded credentials $auth under $policy', ({ policy, auth }) => {
      expect(blockReason(policy, url(`${auth}p01-caldav.icloud.com`))).toMatch(/user name or password/);
    },
  );
  it.each(['icloud.com', 'p01-caldav.icloud.com', 'icloud.com.cn', 'p02.caldav.icloud.com.cn'])(
    'allows iCloud host %s', (host) => expect(blockReason('icloud', url(host))).toBeNull(),
  );
  it.each(['icloud.com.evil.example', 'evilicloud.com', 'example.com'])('names the rejected iCloud host %s', (host) => {
    expect(blockReason('icloud', url(host))).toContain(host);
  });
  it('checks the address without coercing the whole URL to text', () => {
    const target = url('p01-caldav.icloud.com');
    const stringify = vi.spyOn(target, 'toString');
    expect(blockReason('icloud', target)).toBeNull();
    expect(stringify).not.toHaveBeenCalled();
  });
});

describe('redirectBlockReason', () => {
  it.each(policies)('allows exactly MAX_REDIRECTS under %s', (policy) => {
    expect(redirectBlockReason(policy, url('p01.icloud.com'), url('p01.icloud.com'), MAX_REDIRECTS)).toBeNull();
  });
  it.each(policies)('blocks more than MAX_REDIRECTS under %s', (policy) => {
    expect(redirectBlockReason(policy, url('p01.icloud.com'), url('p01.icloud.com'), MAX_REDIRECTS + 1)).toMatch(/too many/);
  });
  it.each(policies)('blocks an http redirect under %s', (policy) => {
    expect(redirectBlockReason(policy, url('p01.icloud.com'), new URL('http://p01.icloud.com/'), 1)).toMatch(/insecure/);
  });
  it('allows a credentialed redirect within the same origin', () => {
    expect(redirectBlockReason('credentialed', url('example.com'), new URL('https://example.com/other?q=1'), 1)).toBeNull();
  });
  it.each(['other.example', 'example.com:8443', 'sub.example.com'])('blocks a credentialed redirect to %s', (host) => {
    expect(redirectBlockReason('credentialed', url('example.com'), url(host), 1)).not.toBeNull();
  });
  it('allows a redirect to another iCloud host', () => {
    expect(redirectBlockReason('icloud', url('p01.icloud.com'), url('p02.icloud.com.cn'), 1)).toBeNull();
  });
  it('blocks an iCloud redirect outside iCloud', () => {
    expect(redirectBlockReason('icloud', url('p01.icloud.com'), url('example.com'), 1)).not.toBeNull();
  });
  it('allows public-to-public redirects', () => {
    expect(redirectBlockReason('public', url('example.com'), url('calendar.google.com'), 1)).toBeNull();
  });
  it.each(['127.0.0.1', '[::1]', 'localhost', '192.168.1.2'])('blocks public-to-%s redirects', (host) => {
    expect(redirectBlockReason('public', url('example.com'), url(host), 1)).toMatch(/local network/);
  });
  it('allows private-to-private feed redirects', () => {
    expect(redirectBlockReason('public', url('192.168.1.2'), url('printer.local'), 1)).toBeNull();
  });
  it.each(policies)('blocks credentials in a redirect target under %s', (policy) => {
    expect(redirectBlockReason(policy, url('p01.icloud.com'), url('user:secret@p01.icloud.com'), 1)).toMatch(/user name or password/);
  });
});

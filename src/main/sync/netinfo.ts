import { networkInterfaces } from 'node:os'

/**
 * Best-guess LAN IPv4 address to advertise in the join code. Prefers a private
 * (RFC1918) non-internal interface; falls back to any non-internal IPv4, then
 * loopback.
 */
export function lanAddress(): string {
  const ifaces = networkInterfaces()
  const candidates: string[] = []
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) candidates.push(ni.address)
    }
  }
  const isPrivate = (ip: string): boolean =>
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)

  return candidates.find(isPrivate) ?? candidates[0] ?? '127.0.0.1'
}

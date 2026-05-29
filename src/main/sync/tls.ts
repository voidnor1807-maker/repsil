import tls, { type TLSSocket } from 'node:tls'

/**
 * TLS with a pre-shared key. The join code's secret IS the PSK, so it both
 * encrypts the channel and authenticates the joiner — only a peer holding the
 * code can complete the handshake. No certificates are exchanged, so cert-chain
 * verification is disabled (authorization comes from the PSK).
 *
 * Pinned to TLS 1.2 PSK-GCM suites for broad, predictable Node/OpenSSL support.
 */
const PSK_CIPHERS = 'PSK-AES256-GCM-SHA384:PSK-AES128-GCM-SHA256'
const PSK_IDENTITY = 'repsil'

export interface PskServer {
  port: number
  close: () => Promise<void>
}

/** Bind a PSK server on an ephemeral port and hand each secure socket to onConn. */
export function createPskServer(
  psk: Buffer,
  onConn: (socket: TLSSocket) => void
): Promise<PskServer> {
  return new Promise((resolve, reject) => {
    const server = tls.createServer({
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
      ciphers: PSK_CIPHERS,
      pskIdentityHint: PSK_IDENTITY,
      pskCallback: (_socket, identity) => (identity === PSK_IDENTITY ? psk : null)
    })

    server.on('secureConnection', onConn)
    server.once('error', reject)
    server.listen(0, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res())
          })
      })
    })
  })
}

/** Connect to a PSK server. Resolves once the secure channel is established. */
export function connectPsk(host: string, port: number, psk: Buffer): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
      ciphers: PSK_CIPHERS,
      // PSK provides authentication; there is no certificate to verify.
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
      pskCallback: () => ({ psk, identity: PSK_IDENTITY })
    })
    socket.once('secureConnect', () => resolve(socket))
    socket.once('error', reject)
  })
}

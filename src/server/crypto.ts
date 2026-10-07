let serverKeyPair: { publicKey: CryptoKey; privateKey: CryptoKey } | null = null
let exportedPublicKeyBase64 = ''

export async function ensureServerKeyPair(db?: any): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  if (serverKeyPair) return serverKeyPair

  if (db) {
    try {
      const pubRow: any = await db.prepare("SELECT value FROM system_config WHERE key = 'federation_public_key'").first()
      const privRow: any = await db.prepare("SELECT value FROM system_config WHERE key = 'federation_private_key'").first()
      if (pubRow && privRow) {
        const pubJwk = JSON.parse(pubRow.value)
        const privJwk = JSON.parse(privRow.value)
        const publicKey = await crypto.subtle.importKey(
          'jwk',
          pubJwk,
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['verify']
        )
        const privateKey = await crypto.subtle.importKey(
          'jwk',
          privJwk,
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['sign']
        )
        serverKeyPair = { publicKey, privateKey }
        exportedPublicKeyBase64 = btoa(JSON.stringify(pubJwk))
        return serverKeyPair
      }
    } catch (e) {
      console.warn('[WebCrypto Key Init]', e)
    }
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  serverKeyPair = keyPair

  const pubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  exportedPublicKeyBase64 = btoa(JSON.stringify(pubJwk))

  if (db) {
    try {
      await db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('federation_public_key', ?), ('federation_private_key', ?)")
        .bind(JSON.stringify(pubJwk), JSON.stringify(privJwk)).run()
    } catch (e) {
      console.warn('[WebCrypto Key Save]', e)
    }
  }

  return serverKeyPair
}

export async function signPayload(payloadString: string): Promise<string> {
  const keys = await ensureServerKeyPair()
  const enc = new TextEncoder().encode(payloadString)
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, enc)
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

export function getExportedPublicKeyBase64(): string {
  return exportedPublicKeyBase64
}

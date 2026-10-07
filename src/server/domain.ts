// ============================================================================
// Root Domain (eTLD+1) Wildcard Deduplication & Anti-Subdomain-Spoofing Utility
// ============================================================================

const MULTI_PART_TLDS = new Set([
  'com.np',
  'org.np',
  'edu.np',
  'net.np',
  'gov.np',
  'co.uk',
  'org.uk',
  'co.in',
  'net.in',
  'com.au',
  'co.nz',
  'co.jp',
])

/**
 * Extracts the effective Root Domain (eTLD+1) from any URL, hostname, or origin.
 * Example outputs:
 * - "https://bot1.attacker.com:3000/api" -> "attacker.com"
 * - "bot2.evil.com" -> "evil.com"
 * - "shop.nepal.com.np" -> "nepal.com.np"
 * - "my-worker.workers.dev" -> "my-worker.workers.dev" (Cloudflare Worker boundary)
 * - "sub1.my-worker.workers.dev" -> "my-worker.workers.dev"
 */
export function extractRootDomain(rawUrlOrHost: string): string {
  if (!rawUrlOrHost) return 'unknown'

  let host = rawUrlOrHost.trim().toLowerCase()

  // Remove protocol
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname
    } catch {
      host = host.split('://')[1].split('/')[0]
    }
  }

  // Remove path and port if present
  host = host.split('/')[0].split(':')[0]

  // IP addresses check (e.g. 127.0.0.1, 10.0.0.1)
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return host
  }

  // Localhost
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return 'localhost'
  }

  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) {
    return host
  }

  // Special handling for *.workers.dev
  if (host.endsWith('.workers.dev')) {
    // If e.g. "sub.my-worker.workers.dev" -> return "my-worker.workers.dev"
    const devIndex = parts.indexOf('workers')
    if (devIndex > 0) {
      return `${parts[devIndex - 1]}.workers.dev`
    }
    return host
  }

  // Check 2-part TLDs (like .com.np, .co.uk)
  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_PART_TLDS.has(lastTwo)) {
    if (parts.length >= 3) {
      return `${parts[parts.length - 3]}.${lastTwo}`
    }
    return host
  }

  // Standard generic TLD (like .com, .net, .io, .dev, .app)
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`
}

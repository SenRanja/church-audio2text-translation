const reservedPublicPaths = new Set([
  'api',
  'ws',
  'health',
  'assets',
  'admin',
  'account',
  'login',
  'settings',
])

export function getPublicUsername(pathname: string) {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length !== 1) return null
  try {
    const username = decodeURIComponent(parts[0])
    if (reservedPublicPaths.has(username.toLocaleLowerCase('en-US'))) return null
    return /^[\p{L}\p{N}._@-]{3,64}$/u.test(username) ? username : null
  } catch {
    return null
  }
}

export function getPublicBroadcastUrl(origin: string, username: string) {
  return new URL(`/${encodeURIComponent(username)}`, origin).toString()
}
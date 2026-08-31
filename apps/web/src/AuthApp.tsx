import { Church } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'

import App from './App'
import './Auth.css'
import { PublicCaptionPage } from './PublicCaptionPage'
import { getPublicUsername } from './public-route'

export interface CurrentUser {
  id: string
  username: string
  role: 'admin' | 'user'
  isSeed: boolean
  createdAt: number
}

export default function AuthApp() {
  const publicUsername = getPublicUsername(window.location.pathname)
  if (publicUsername) return <PublicCaptionPage username={publicUsername} />
  return <AuthenticatedApp />
}

function AuthenticatedApp() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetch('/api/auth/me')
      .then(async (response) => {
        if (!response.ok) return
        const result = (await response.json()) as { user: CurrentUser | null }
        setUser(result.user)
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
  }

  if (loading) return <div className="auth-loading" aria-label="Loading" />
  if (!user) return <LoginScreen onLogin={setUser} />
  return <App user={user} onLogout={logout} />
}

function LoginScreen({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setError(false)
    setSubmitting(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!response.ok) {
        setError(true)
        return
      }
      const result = (await response.json()) as { user: CurrentUser }
      onLogin(result.user)
    } catch {
      setError(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <form className="login-form" onSubmit={(event) => void login(event)}>
        <div className="login-brand" aria-label="Living Word">
          <span><Church size={25} strokeWidth={1.8} /></span>
          <strong>Living Word</strong>
        </div>
        <label>
          <span>Username</span>
          <input
            name="username"
            value={username}
            autoComplete="username"
            required
            maxLength={64}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            name="password"
            type="password"
            value={password}
            autoComplete="current-password"
            required
            maxLength={128}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="login-error" role="alert">Error</p>}
        <button type="submit" disabled={submitting}>Sign in</button>
      </form>
    </main>
  )
}
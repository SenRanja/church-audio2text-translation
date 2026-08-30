import { LogOut, Trash2, UserPlus, UserRound, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import type { CurrentUser } from './AuthApp'

export function AccountMenu({ user, onLogout }: { user: CurrentUser; onLogout: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<CurrentUser[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  const loadUsers = async () => {
    if (user.role !== 'admin') return
    const response = await fetch('/api/admin/users')
    if (!response.ok) {
      setError(true)
      return
    }
    const result = (await response.json()) as { users: CurrentUser[] }
    setUsers(result.users)
  }

  const addUser = async (event: FormEvent) => {
    event.preventDefault()
    setError(false)
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!response.ok) {
      setError(true)
      return
    }
    setUsername('')
    setPassword('')
    await loadUsers()
  }

  const deleteUser = async (id: string) => {
    setError(false)
    const response = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      setError(true)
      return
    }
    await loadUsers()
  }

  return (
    <div className="account-menu">
      <button
        className="account-trigger"
        type="button"
        aria-label="Account"
        aria-expanded={open}
        title="Account"
        onClick={() => {
          if (!open) void loadUsers()
          setOpen((current) => !current)
        }}
      >
        <UserRound size={18} />
        <span>{user.username}</span>
      </button>
      {open && (
        <div className="account-popover">
          <header>
            <div><strong>{user.username}</strong><span>{user.role}</span></div>
            <button type="button" aria-label="Close account menu" onClick={() => setOpen(false)}>
              <X size={17} />
            </button>
          </header>

          {user.role === 'admin' && (
            <>
              <form className="account-create" onSubmit={(event) => void addUser(event)}>
                <input
                  aria-label="New username"
                  placeholder="Username"
                  value={username}
                  autoComplete="off"
                  minLength={3}
                  maxLength={64}
                  required
                  onChange={(event) => setUsername(event.target.value)}
                />
                <input
                  aria-label="New password"
                  placeholder="Password"
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button type="submit" aria-label="Add account" title="Add account">
                  <UserPlus size={18} />
                </button>
              </form>
              {error && <p className="account-error" role="alert">Error</p>}
              <div className="account-list">
                {users.map((account) => (
                  <div key={account.id}>
                    <span><strong>{account.username}</strong><small>{account.role}</small></span>
                    <button
                      type="button"
                      aria-label={`Delete ${account.username}`}
                      title={account.isSeed ? 'Seed account' : 'Delete account'}
                      disabled={account.isSeed}
                      onClick={() => void deleteUser(account.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <button className="logout-button" type="button" onClick={() => void onLogout()}>
            <LogOut size={17} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
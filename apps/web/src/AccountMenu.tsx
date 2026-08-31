import { Download, FileText, LogOut, RotateCcw, Save, Trash2, UserPlus, UserRound, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import type { CurrentUser } from './AuthApp'

interface AuthSettings {
  sessionLifetimeHours: number
}

interface PromptResult {
  prompt: string
  usingDefault: boolean
  editsChurchDefault: boolean
}

type PromptSaveState = 'saved' | 'dirty' | 'saving' | 'error'

interface TranscriptSummary {
  id: string
  filename: string
  createdAt: number
}

export function AccountMenu({ user, onLogout }: { user: CurrentUser; onLogout: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<CurrentUser[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [settings, setSettings] = useState<AuthSettings>({
    sessionLifetimeHours: 12,
  })
  const [prompt, setPrompt] = useState('')
  const [usingDefaultPrompt, setUsingDefaultPrompt] = useState(true)
  const [editsChurchDefault, setEditsChurchDefault] = useState(user.isSeed)
  const [promptSaveState, setPromptSaveState] = useState<PromptSaveState>('saved')
  const [transcripts, setTranscripts] = useState<TranscriptSummary[]>([])

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

  const loadAccountData = async () => {
    setError(false)
    const [promptResponse, transcriptResponse] = await Promise.all([
      fetch('/api/auth/prompt'),
      fetch('/api/auth/transcripts'),
    ])
    if (!promptResponse.ok || !transcriptResponse.ok) {
      setError(true)
      return
    }
    const promptResult = (await promptResponse.json()) as PromptResult
    setPrompt(promptResult.prompt)
    setUsingDefaultPrompt(promptResult.usingDefault)
    setEditsChurchDefault(promptResult.editsChurchDefault)
    setPromptSaveState('saved')
    setTranscripts(((await transcriptResponse.json()) as { transcripts: TranscriptSummary[] }).transcripts)

    if (user.role !== 'admin') return
    const [usersResponse, settingsResponse] = await Promise.all([
      fetch('/api/admin/users'),
      fetch('/api/admin/settings'),
    ])
    if (!usersResponse.ok || !settingsResponse.ok) {
      setError(true)
      return
    }
    setUsers(((await usersResponse.json()) as { users: CurrentUser[] }).users)
    setSettings(((await settingsResponse.json()) as { settings: AuthSettings }).settings)
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

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault()
    setError(false)
    const response = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings),
    })
    if (!response.ok) {
      setError(true)
      return
    }
    setSettings(((await response.json()) as { settings: AuthSettings }).settings)
  }

  const updatePrompt = async (nextPrompt: string) => {
    setError(false)
    setPromptSaveState('saving')
    try {
      const response = await fetch('/api/auth/prompt', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: nextPrompt }),
      })
      if (!response.ok) throw new Error('Prompt update failed')
      const result = (await response.json()) as PromptResult
      setPrompt(result.prompt)
      setUsingDefaultPrompt(result.usingDefault)
      setEditsChurchDefault(result.editsChurchDefault)
      setPromptSaveState('saved')
    } catch {
      setError(true)
      setPromptSaveState('error')
    }
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
          if (!open) void loadAccountData()
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
              <form className="account-section account-settings" onSubmit={(event) => void saveSettings(event)}>
                <div className="account-section-heading">
                  <strong>Login policy</strong>
                  <button type="submit"><Save size={15} /> Save</button>
                </div>
                <label>
                  <span>Session lifetime</span>
                  <span className="duration-input">
                    <input
                      aria-label="Session lifetime in hours"
                      type="number"
                      min={1}
                      max={720}
                      value={settings.sessionLifetimeHours}
                      onChange={(event) => setSettings((current) => ({
                        ...current,
                        sessionLifetimeHours: Number(event.target.value),
                      }))}
                    />
                    hours
                  </span>
                </label>
                <p className="account-policy-note">Each user can sign in on one terminal at a time.</p>
              </form>
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

          <section className="account-section account-prompt">
            <div className="account-section-heading">
              <span><strong>Translation prompt</strong><small>{usingDefaultPrompt ? 'Church default' : 'Custom'}</small></span>
              <span className={`prompt-save-status status-${promptSaveState}`} role="status">
                <i /> {promptStatusLabel(promptSaveState)}
              </span>
            </div>
            <p className="account-prompt-note">
              {editsChurchDefault
                ? 'Changes here update the Church default prompt for every user.'
                : 'A custom prompt applies only to this login and is not saved after you sign in again.'}
            </p>
            <textarea
              aria-label="Translation prompt"
              value={prompt}
              maxLength={12000}
              rows={8}
              onChange={(event) => {
                setPrompt(event.target.value)
                if (!editsChurchDefault) setUsingDefaultPrompt(false)
                setPromptSaveState('dirty')
              }}
            />
            <div className="prompt-actions">
              <button type="button" onClick={() => void updatePrompt('')}>
                <RotateCcw size={15} /> {editsChurchDefault ? 'Use built-in default' : 'Use church default'}
              </button>
              <button
                className={promptSaveState === 'saving' ? 'is-saving' : ''}
                type="button"
                disabled={promptSaveState === 'saving'}
                onClick={() => void updatePrompt(prompt)}
              >
                <Save size={15} /> {promptSaveState === 'saving' ? 'Saving' : 'Save prompt'}
              </button>
            </div>
          </section>

          <section className="account-section account-transcripts">
            <div className="account-section-heading">
              <span><strong>Source transcripts</strong><small>Latest 14</small></span>
            </div>
            {transcripts.length === 0 ? (
              <p className="account-empty">No source transcripts yet.</p>
            ) : (
              <div className="transcript-list">
                {transcripts.map((transcript) => (
                  <a
                    key={transcript.id}
                    href={`/api/auth/transcripts/${encodeURIComponent(transcript.id)}`}
                    download={transcript.filename}
                  >
                    <FileText size={16} />
                    <span><strong>{formatTranscriptDate(transcript.createdAt)}</strong><small>{transcript.filename}</small></span>
                    <Download size={16} />
                  </a>
                ))}
              </div>
            )}
          </section>

          {error && <p className="account-error" role="alert">Error</p>}

          <button className="logout-button" type="button" onClick={() => void onLogout()}>
            <LogOut size={17} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function promptStatusLabel(state: PromptSaveState) {
  if (state === 'dirty') return 'Unsaved'
  if (state === 'saving') return 'Saving'
  if (state === 'error') return 'Error'
  return 'Saved'
}

function formatTranscriptDate(createdAt: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(createdAt)
}
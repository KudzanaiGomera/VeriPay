import { useState, type FormEvent } from 'react'
import { MailCheck, ShieldCheck } from 'lucide-react'
import { reload, sendEmailVerification, type User } from 'firebase/auth'
import {
  getAuthErrorMessage,
  registerWithEmail,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
} from './authService'
import { auth, isFirebaseConfigured } from '../../lib/firebase'

export type AuthMode = 'signIn' | 'signUp' | 'reset'

type Props = {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onClose: () => void
  user?: User | null
  onVerified: (user: User) => void
}

const modeTitles: Record<AuthMode, string> = {
  signIn: 'Welcome back',
  signUp: 'Create your account',
  reset: 'Reset your password',
}

export function AuthPanel({ mode, onModeChange, onClose, user, onVerified }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (mode === 'signUp' && password.length < 8) {
      setError('Choose a password with at least 8 characters.')
      return
    }

    setBusy(true)
    try {
      if (mode === 'signUp') {
        await registerWithEmail(name.trim(), email.trim(), password)
        setMessage('Account created. Check your inbox for the email verification link.')
      } else if (mode === 'signIn') {
        await signInWithEmail(email.trim(), password)
      } else {
        await sendPasswordReset(email.trim())
        setMessage('If an account exists for that email, a password reset link is on its way.')
      }
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError))
    } finally {
      setBusy(false)
    }
  }

  async function handleGoogleSignIn() {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await signInWithGoogle()
    } catch (signInError) {
      setError(getAuthErrorMessage(signInError))
    } finally {
      setBusy(false)
    }
  }

  async function resendVerification() {
    if (!auth?.currentUser) {
      setError('Your sign-in session has expired. Sign in again to resend the link.')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')
    try {
      await sendEmailVerification(auth.currentUser)
      setMessage('A new verification link has been sent.')
    } catch (sendError) {
      setError(getAuthErrorMessage(sendError))
    } finally {
      setBusy(false)
    }
  }

  async function checkVerification() {
    if (!auth?.currentUser) {
      setError('Your sign-in session has expired. Sign in again.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await reload(auth.currentUser)
      if (auth.currentUser.emailVerified) {
        await auth.currentUser.getIdToken(true)
        onVerified(auth.currentUser)
      } else {
        setMessage('Your email is not verified yet. Open the link in your inbox, then try again.')
      }
    } catch (verificationError) {
      setError(getAuthErrorMessage(verificationError))
    } finally {
      setBusy(false)
    }
  }

  if (user && !user.emailVerified) {
    return (
      <section className="auth-page">
        <div className="auth-card">
          <div className="auth-icon"><MailCheck size={24} /></div>
          <span className="eyebrow strong">One quick step</span>
          <h1>Verify your email</h1>
          <p className="auth-description">
            We sent a verification link to <strong>{user.email}</strong>. Verify it before using the dashboard.
          </p>
          {message && <p className="auth-message" role="status">{message}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <div className="auth-actions">
            <button type="button" className="primary-button auth-submit" onClick={checkVerification} disabled={busy}>
              {busy ? 'Checking…' : 'I verified my email'}
            </button>
            <button type="button" className="secondary-button auth-submit" onClick={resendVerification} disabled={busy}>
              Resend verification email
            </button>
          </div>
          <button type="button" className="text-button" onClick={onClose}>Sign out</button>
        </div>
      </section>
    )
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <button type="button" className="auth-close" onClick={onClose} aria-label="Close sign-in">×</button>
        <div className="auth-icon"><ShieldCheck size={24} /></div>
        <span className="eyebrow strong">VeriPay account</span>
        <h1>{modeTitles[mode]}</h1>
        <p className="auth-description">
          {mode === 'signUp'
            ? 'Create an account to access your VeriPay workspace.'
            : mode === 'reset'
              ? 'We’ll email you a secure link to choose a new password.'
              : 'Sign in to access your verification dashboard.'}
        </p>

        {!isFirebaseConfigured && (
          <div className="auth-setup-notice" role="status">
            Firebase is not connected yet. Follow the setup steps in the project README, then add your Firebase web app values to <code>.env</code>.
          </div>
        )}

        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'signUp' && (
            <label>
              Full name
              <input
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
              />
            </label>
          )}
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {mode !== 'reset' && (
            <label>
              Password
              <input
                type="password"
                autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                minLength={mode === 'signUp' ? 8 : undefined}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'signUp' ? 'At least 8 characters' : 'Your password'}
              />
            </label>
          )}
          <button className="primary-button auth-submit" type="submit" disabled={busy || !isFirebaseConfigured}>
            {busy ? 'Please wait…' : mode === 'signUp' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
          </button>
        </form>

        {mode !== 'reset' && (
          <>
            <div className="auth-divider"><span>or</span></div>
            <button
              type="button"
              className="secondary-button auth-submit auth-google-button"
              onClick={handleGoogleSignIn}
              disabled={busy || !isFirebaseConfigured}
            >
              <span className="google-mark" aria-hidden="true">G</span>
              Continue with Google
            </button>
          </>
        )}

        <div className="auth-switches">
          {mode === 'signIn' && (
            <>
              <button type="button" className="text-button" onClick={() => onModeChange('reset')}>Forgot password?</button>
              <span>New to VeriPay?</span>
              <button type="button" className="text-button" onClick={() => onModeChange('signUp')}>Create account</button>
            </>
          )}
          {mode === 'signUp' && (
            <>
              <span>Already registered?</span>
              <button type="button" className="text-button" onClick={() => onModeChange('signIn')}>Sign in</button>
            </>
          )}
          {mode === 'reset' && (
            <button type="button" className="text-button" onClick={() => onModeChange('signIn')}>Back to sign in</button>
          )}
        </div>
      </div>
    </section>
  )
}

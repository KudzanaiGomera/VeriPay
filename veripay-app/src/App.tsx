import { lazy, Suspense, useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import {
  ArrowRight,
  Banknote,
  Building2,
  FileCheck2,
  Files,
  Landmark,
  Lock,
  ShieldCheck,
  Sun,
  Moon,
} from 'lucide-react'
import { AuthPanel, type AuthMode } from './features/auth/AuthPanel'
import { getAuthErrorMessage, signOutUser } from './features/auth/authService'
import { auth } from './lib/firebase'
import './App.css'

const VerificationPanel = lazy(() => import('./features/verification/VerificationPanel')
  .then((module) => ({ default: module.VerificationPanel })))

const navItems = [
  { key: 'overview', label: 'Overview' },
  { key: 'services', label: 'Services' },
  { key: 'how-it-works', label: 'How it works' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'dashboard', label: 'Dashboard' },
] as const

const services = [
  {
    icon: Banknote,
    title: 'Income and deposit comparison',
    description: 'Compare an extracted payslip net-pay amount with salary-labeled bank deposits when both documents are included.',
  },
  {
    icon: Landmark,
    title: 'Payroll and tax checks',
    description: 'Read selected payslip details for review. Tax calculations and payroll-rule validation are not provided.',
  },
  {
    icon: ShieldCheck,
    title: 'Identity consistency',
    description: 'Compare labeled names across selected records when text can be read clearly.',
  },
  {
    icon: FileCheck2,
    title: 'Document review',
    description: 'Provide extraction feedback and advisory comparisons, not authenticity or fraud determinations.',
  },
] as const

const audiences = [
  { icon: Landmark, title: 'Lenders', description: 'Review income information as part of an application.' },
  { icon: Building2, title: 'Employers and payroll teams', description: 'Check payroll details against supporting records.' },
  { icon: Files, title: 'Property managers', description: 'Review affordability documents with clearer signals.' },
] as const

const processSteps = [
  'Choose one, two, or three document types and submit the files you have permission to share.',
  'Compare readable names and, when available, payslip net pay with salary-labeled deposits.',
  'Review any differences or unusual details in context.',
  'Prepare a clear summary for a human decision-maker.',
] as const

const privacyPrinciples = [
  {
    icon: Lock,
    title: 'Private document access',
    description: 'Only you can view your case records. Uploaded documents are not available for direct browser downloads.',
  },
  {
    icon: ShieldCheck,
    title: 'Keep people in the decision loop',
    description: 'Automated checks are advisory. Review source documents and make decisions with appropriate human judgment.',
  },
  {
    icon: FileCheck2,
    title: 'Limited retention',
    description: 'Cases are scheduled for deletion after 7 days. You can delete a case and its uploaded files sooner.',
  },
] as const

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const savedTheme = window.localStorage.getItem('veripay-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function App() {
  const [activeTab, setActiveTab] = useState<(typeof navItems)[number]['key']>('overview')
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(() => !auth)
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    window.localStorage.setItem('veripay-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!auth) {
      return
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setAuthReady(true)
      if (nextUser?.emailVerified) {
        setAuthMode(null)
      }
    })
  }, [])

  function selectTab(tab: (typeof navItems)[number]['key']) {
    if (tab === 'dashboard' && !user?.emailVerified) {
      setAuthMode('signIn')
      return
    }

    setActiveTab(tab)
  }

  async function handleSignOut() {
    setAuthError('')
    try {
      await signOutUser()
      setActiveTab('overview')
    } catch (error) {
      setAuthError(getAuthErrorMessage(error))
    }
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark">V</div>
          <div>
            <div className="brand-name">VeriPay</div>
            <div className="eyebrow">Financial verification</div>
          </div>
        </div>

        <nav className="nav-links">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={activeTab === item.key ? 'nav-button active' : 'nav-button'}
              onClick={() => selectTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <button
            type="button"
            className="secondary-button compact theme-toggle"
            onClick={() => setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-pressed={theme === 'light'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
          {user ? (
            <>
              <span className="user-email">{user.displayName || user.email}</span>
              <button type="button" className="secondary-button compact" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="primary-button compact" onClick={() => setAuthMode('signIn')}>
              Sign in
            </button>
          )}
        </div>
      </header>

      <main className="main-content">
        {authError && <p className="auth-error global-auth-error" role="alert">{authError}</p>}
        {!authReady ? (
          <section className="auth-page"><p>Checking your sign-in…</p></section>
        ) : user && !user.emailVerified ? (
          <AuthPanel
            mode="signIn"
            onModeChange={setAuthMode}
            onClose={handleSignOut}
            user={user}
            onVerified={(verifiedUser) => {
              setUser(verifiedUser)
              setAuthMode(null)
              setActiveTab('dashboard')
            }}
          />
        ) : authMode ? (
          <AuthPanel
            mode={authMode}
            onModeChange={setAuthMode}
            onClose={() => setAuthMode(null)}
            onVerified={setUser}
          />
        ) : (
          <>
        {activeTab === 'overview' && (
          <>
            <section className="hero-panel">
              <div className="hero-copy">
                <div className="chip-row">
                  <span className="chip chip-ghost">For lenders, employers, and property teams</span>
                  <span className="chip chip-primary">Service preview</span>
                </div>
                <h1>Review financial documents with greater clarity.</h1>
                <p>
                  VeriPay is designed to help teams compare payslips, bank statements, and identity details,
                  then highlight differences for a person to review.
                </p>
                <div className="cta-row">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => user?.emailVerified ? setActiveTab('dashboard') : setAuthMode('signUp')}
                  >
                    {user?.emailVerified ? 'Open dashboard' : 'Create an account'} <ArrowRight size={16} />
                  </button>
                  <button type="button" className="secondary-button" onClick={() => selectTab('services')}>
                    Explore services
                  </button>
                </div>
                <div className="mini-stats">
                  <div>
                    <strong>Payslips</strong>
                    <span>income and tax details</span>
                  </div>
                  <div>
                    <strong>Bank statements</strong>
                    <span>deposits and income</span>
                  </div>
                  <div>
                    <strong>Identity documents</strong>
                    <span>details for comparison</span>
                  </div>
                </div>
              </div>

              <div className="hero-visual">
                <div className="visual-card large">
                  <div className="visual-header">
                    <span className="dot green" />
                    <span className="dot amber" />
                    <span className="dot red" />
                    <span className="visual-label">Example only</span>
                  </div>
                  <div className="score-ring">
                    <div>
                      <strong>31</strong>
                      <span>Risk score</span>
                    </div>
                  </div>
                  <div className="score-breakdown">
                    <div>
                      <span className="value">PASS</span>
                      <em>Salary consistency</em>
                    </div>
                    <div>
                      <span className="value warn">WARNING</span>
                      <em>Tax review</em>
                    </div>
                    <div>
                      <span className="value fail">FAIL</span>
                      <em>Document anomaly</em>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <p className="service-notice" role="note">
              Upload one, two, or three document types for an advisory review. Sign in to start a case and download its PDF report.
            </p>

            <section className="panel-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow strong">Who it serves</span>
                  <h2>Useful for teams reviewing financial documents</h2>
                </div>
              </div>

              <div className="service-grid">
                {audiences.map(({ icon: Icon, title, description }) => (
                  <article className="info-card" key={title}>
                    <div className="card-icon"><Icon size={20} /></div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === 'dashboard' && user?.emailVerified && (
          <Suspense fallback={<section className="panel-section">Loading your document reviews…</section>}>
            <VerificationPanel user={user} />
          </Suspense>
        )}

        {activeTab === 'services' && (
          <section className="panel-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow strong">Our services</span>
                <h2>Clearer reviews of financial documents</h2>
              </div>
            </div>

            <div className="service-grid">
              {services.map(({ icon: Icon, title, description }) => (
                <article className="info-card" key={title}>
                  <div className="card-icon"><Icon size={20} /></div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'how-it-works' && (
          <section className="panel-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow strong">How it works</span>
                <h2>A straightforward document review</h2>
              </div>
            </div>

            <p className="service-notice" role="note">
              Document reading and checks require the Firebase services to be configured and deployed for this project.
            </p>

            <div className="process-steps">
              {processSteps.map((step, index) => (
                <div className="process-step" key={step}>
                  <div className="process-step-number">0{index + 1}</div>
                  <div>
                    <strong>Step {index + 1}</strong>
                    <p>{step}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'privacy' && (
          <section className="panel-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow strong">Privacy and responsible use</span>
                <h2>Handle sensitive documents thoughtfully</h2>
              </div>
            </div>

            <div className="service-grid">
              {privacyPrinciples.map(({ icon: Icon, title, description }) => (
                <article className="info-card" key={title}>
                  <div className="card-icon"><Icon size={20} /></div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </section>
        )}
          </>
        )}
      </main>

      <footer className="site-footer">
        <div>
          <strong>VeriPay</strong>
          <span>Financial document review</span>
        </div>
        <div className="footer-links">
          <span><Banknote size={14} /> Income checks</span>
          <span><Files size={14} /> Document review</span>
          <span><ShieldCheck size={14} /> Human review</span>
        </div>
      </footer>
    </div>
  )
}

export default App

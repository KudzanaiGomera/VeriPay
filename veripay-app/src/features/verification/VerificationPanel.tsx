import { useEffect, useState, type FormEvent } from 'react'
import { Download, FileUp, LoaderCircle, Trash2 } from 'lucide-react'
import type { User } from 'firebase/auth'
import {
  createVerificationCase,
  createVerificationReport,
  deleteVerificationCase,
  documentLabels,
  getVerificationErrorMessage,
  runDocumentChecks,
  subscribeToVerificationCases,
  uploadCaseDocument,
  type CaseStatus,
  type CheckStatus,
  type DocumentType,
  type VerificationCase,
} from './verificationService'

const documentOptions: { type: DocumentType; label: string }[] = [
  { type: 'payslip', label: documentLabels.payslip },
  { type: 'bank-statement', label: documentLabels['bank-statement'] },
  { type: 'identity-document', label: documentLabels['identity-document'] },
]

const acceptedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const maxFileSize = 10 * 1024 * 1024

type Props = {
  user: User
}

function getCaseStatusLabel(status: CaseStatus): string {
  switch (status) {
    case 'uploading':
      return 'Uploading'
    case 'processing':
      return 'Checking documents'
    case 'complete':
      return 'Checks complete'
    case 'failed':
      return 'Needs attention'
    case 'deleting':
      return 'Deletion pending'
  }
}

function getCaseStatusClass(status: CaseStatus): string {
  if (status === 'complete') {
    return 'success'
  }
  if (status === 'failed') {
    return 'danger'
  }
  return 'warning'
}

function getCheckStatusClass(status: CheckStatus): string {
  if (status === 'matched') {
    return 'success'
  }
  if (status === 'needs_review') {
    return 'warning'
  }
  return 'neutral'
}

export function VerificationPanel({ user }: Props) {
  const [selectedTypes, setSelectedTypes] = useState<DocumentType[]>([])
  const [files, setFiles] = useState<Partial<Record<DocumentType, File>>>({})
  const [cases, setCases] = useState<VerificationCase[]>([])
  const [busy, setBusy] = useState(false)
  const [deletingCaseId, setDeletingCaseId] = useState<string | null>(null)
  const [retryingCaseId, setRetryingCaseId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => subscribeToVerificationCases(
    user.uid,
    setCases,
    (subscribeError) => setError(getVerificationErrorMessage(subscribeError)),
  ), [user.uid])

  function toggleDocumentType(type: DocumentType, checked: boolean) {
    setSelectedTypes((current) => {
      const next = checked ? [...new Set([...current, type])] : current.filter((selectedType) => selectedType !== type)
      return next
    })
    if (!checked) {
      setFiles((current) => {
        const next = { ...current }
        delete next[type]
        return next
      })
    }
  }

  function handleFileChange(type: DocumentType, file: File | undefined): boolean {
    setError('')
    if (!file) {
      setFiles((current) => {
        const next = { ...current }
        delete next[type]
        return next
      })
      return true
    }
    if (!acceptedMimeTypes.has(file.type)) {
      setFiles((current) => {
        const next = { ...current }
        delete next[type]
        return next
      })
      setError(`${documentLabels[type]} must be a PDF, JPG, or PNG file.`)
      return false
    }
    if (file.size === 0 || file.size > maxFileSize) {
      setFiles((current) => {
        const next = { ...current }
        delete next[type]
        return next
      })
      if (file.size === 0) {
        setError(`${documentLabels[type]} cannot be empty.`)
        return false
      }
      setError(`${documentLabels[type]} must be 10 MB or smaller.`)
      return false
    }
    setFiles((current) => ({ ...current, [type]: file }))
    return true
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')

    const normalizedTypes = Array.from(new Set(selectedTypes))

    if (normalizedTypes.length < 1 || normalizedTypes.length > 3) {
      setError('Choose one, two, or three document types for this review.')
      return
    }
    const missingFile = normalizedTypes.find((type) => !files[type])
    if (missingFile) {
      setError(`Choose a ${documentLabels[missingFile].toLowerCase()} file.`)
      return
    }
    if (!consent) {
      setError('Confirm that you have permission to submit these documents.')
      return
    }

    setBusy(true)
    setProgress(0)
    let caseId: string | null = null
    try {
      caseId = await createVerificationCase(normalizedTypes)
      for (let index = 0; index < normalizedTypes.length; index += 1) {
        const type = normalizedTypes[index]
        const file = files[type]
        if (!file) {
          throw new Error(`The ${documentLabels[type].toLowerCase()} file is missing.`)
        }
        setProgressLabel(`Uploading ${documentLabels[type]} (${index + 1} of ${selectedTypes.length})`)
        await uploadCaseDocument(user.uid, caseId, type, file, setProgress)
      }

      setProgressLabel('Reading documents and checking selected details')
      setProgress(0)
      await runDocumentChecks(caseId)
      setMessage('Document checks are complete. Review every result against the original documents.')
      setSelectedTypes([])
      setFiles({})
      setConsent(false)
    } catch (submitError) {
      const baseMessage = getVerificationErrorMessage(submitError)
      setError(caseId
        ? `${baseMessage} You can delete this case from your recent reviews if its uploads are incomplete.`
        : baseMessage)
    } finally {
      setBusy(false)
      setProgressLabel('')
    }
  }

  async function handleDelete(verificationCase: VerificationCase) {
    const confirmed = window.confirm('Delete this case and its uploaded documents now? This cannot be undone.')
    if (!confirmed) {
      return
    }

    setError('')
    setMessage('')
    setDeletingCaseId(verificationCase.id)
    try {
      await deleteVerificationCase(verificationCase.id)
      setMessage('The case and its uploaded documents were deleted.')
    } catch (deleteError) {
      setError(getVerificationErrorMessage(deleteError))
    } finally {
      setDeletingCaseId(null)
    }
  }

  async function handleDownloadReport(verificationCase: VerificationCase) {
    setError('')
    try {
      await createVerificationReport(verificationCase)
    } catch (reportError) {
      setError(getVerificationErrorMessage(reportError))
    }
  }

  async function handleRetryChecks(verificationCase: VerificationCase) {
    setError('')
    setMessage('')
    setRetryingCaseId(verificationCase.id)
    try {
      await runDocumentChecks(verificationCase.id)
      setMessage('Document checks are complete. Review every result against the original documents.')
    } catch (retryError) {
      setError(getVerificationErrorMessage(retryError))
    } finally {
      setRetryingCaseId(null)
    }
  }

  return (
    <div className="verification-workspace">
      <section className="panel-section upload-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow strong">Document review</span>
            <h1>Check selected documents together</h1>
          </div>
        </div>
        <p className="upload-intro">
          Choose one, two, or all three document types. Cross-document checks are limited to details that can be read clearly.
        </p>
        <p className="service-notice" role="note">
          Checks are advisory, and OCR can make mistakes. When enabled, documents are sent to Google Document AI for text extraction. Review each result against the original documents. Files are scheduled for deletion after 7 days, and you can delete a case sooner.
        </p>

        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}

        <form className="verification-form" onSubmit={handleSubmit}>
          <fieldset disabled={busy}>
            <legend>Choose documents to include</legend>
            <p className="form-hint">Upload one file for each selected type. PDF, JPG, and PNG are supported; maximum 10 MB per file.</p>
            <div className="document-type-list">
              {documentOptions.map(({ type, label }) => (
                <label className="document-type-option" key={type}>
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(type)}
                    onChange={(event) => toggleDocumentType(type, event.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {selectedTypes.length > 0 && (
            <div className="document-file-list">
              {documentOptions.filter(({ type }) => selectedTypes.includes(type)).map(({ type, label }) => (
                <label className="document-file-field" key={type}>
                  <span>{label}</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    disabled={busy}
                    onChange={(event) => {
                      const accepted = handleFileChange(type, event.currentTarget.files?.[0])
                      if (!accepted) {
                        event.currentTarget.value = ''
                      }
                    }}
                  />
                  <small>{files[type]?.name || 'Choose a PDF, JPG, or PNG file'}</small>
                </label>
              ))}
            </div>
          )}

          <label className="consent-option">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>I have permission to submit these documents and understand they will be processed by Google Document AI for text extraction.</span>
          </label>

          {busy && (
            <div className="upload-progress" role="status" aria-live="polite">
              <span><LoaderCircle size={16} className="spin-icon" /> {progressLabel}</span>
              {progressLabel.startsWith('Uploading') && <progress max={100} value={progress} />}
            </div>
          )}

          <button
            type="submit"
            className="primary-button"
            disabled={busy || selectedTypes.length === 0 || !consent}
          >
            <FileUp size={18} />
            {busy ? 'Please wait…' : 'Upload and check documents'}
          </button>
        </form>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow strong">Your cases</span>
            <h2>Recent document reviews</h2>
          </div>
        </div>

        {cases.length === 0 ? (
          <p className="empty-cases">Your document reviews will appear here after you submit a case.</p>
        ) : (
          <div className="case-list">
            {cases.map((verificationCase) => (
              <article className="case-card info-card" key={verificationCase.id}>
                <div className="case-card-heading">
                  <div>
                    <h3>Review {verificationCase.id.slice(0, 8)}</h3>
                    <p>
                      {verificationCase.documentTypes.map((type) => documentLabels[type]).join(' · ')}
                    </p>
                  </div>
                  <span className={`status-bullet ${getCaseStatusClass(verificationCase.status)}`}>
                    {getCaseStatusLabel(verificationCase.status)}
                  </span>
                </div>

                <p className="case-expiry">
                  {verificationCase.expiresAt
                    ? `Files are scheduled for deletion ${verificationCase.expiresAt.toLocaleString()}.`
                    : 'Files are scheduled for deletion after 7 days.'}
                </p>

                {verificationCase.checks.length > 0 && (
                  <ul className="check-result-list">
                    {verificationCase.checks.map((check) => (
                      <li key={check.id}>
                        <div className="check-result-heading">
                          <strong>{check.label}</strong>
                          <span className={`status-bullet ${getCheckStatusClass(check.status)}`}>
                            {check.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p>{check.detail}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {verificationCase.errorMessage && (
                  <p className="case-expiry" role="status">{verificationCase.errorMessage}</p>
                )}

                <div className="case-actions">
                  {verificationCase.status === 'complete' && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleDownloadReport(verificationCase)}
                    >
                      <Download size={16} /> Download PDF report
                    </button>
                  )}
                  {verificationCase.status === 'failed' && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={retryingCaseId === verificationCase.id}
                      onClick={() => void handleRetryChecks(verificationCase)}
                    >
                      {retryingCaseId === verificationCase.id ? 'Retrying checks…' : 'Retry checks'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary-button delete-case-button"
                    disabled={retryingCaseId === verificationCase.id || deletingCaseId === verificationCase.id}
                    onClick={() => void handleDelete(verificationCase)}
                  >
                    <Trash2 size={16} />
                    {deletingCaseId === verificationCase.id
                      ? 'Deleting…'
                      : verificationCase.status === 'deleting' ? 'Retry deletion' : 'Delete now'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

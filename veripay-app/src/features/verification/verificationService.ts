import {
  collection,
  onSnapshot,
  query,
  Timestamp,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { ref as storageRef, uploadBytesResumable } from 'firebase/storage'
import {
  requireFirestore,
  requireFunctions,
  requireStorage,
} from '../../lib/firebase'

export const documentLabels = {
  payslip: 'Payslip',
  'bank-statement': 'Bank statement',
  'identity-document': 'Identity document',
} as const

export type DocumentType = keyof typeof documentLabels
export type CheckStatus = 'matched' | 'needs_review' | 'info'
export type CaseStatus = 'uploading' | 'processing' | 'complete' | 'failed' | 'deleting'

export type CheckResult = {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

export type VerificationCase = {
  id: string
  documentTypes: DocumentType[]
  status: CaseStatus
  createdAt: Date | null
  expiresAt: Date | null
  checks: CheckResult[]
  errorMessage: string | null
}

const validDocumentTypes = Object.keys(documentLabels)
const validCaseStatuses: CaseStatus[] = ['uploading', 'processing', 'complete', 'failed', 'deleting']
const validCheckStatuses: CheckStatus[] = ['matched', 'needs_review', 'info']

function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && validDocumentTypes.includes(value)
}

function parseCaseStatus(value: unknown): CaseStatus {
  return typeof value === 'string' && validCaseStatuses.includes(value as CaseStatus)
    ? value as CaseStatus
    : 'failed'
}

function parseCheckResult(value: unknown): CheckResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== 'string'
    || typeof record.label !== 'string'
    || typeof record.detail !== 'string'
    || typeof record.status !== 'string'
    || !validCheckStatuses.includes(record.status as CheckStatus)
  ) {
    return null
  }
  return {
    id: record.id,
    label: record.label,
    detail: record.detail,
    status: record.status as CheckStatus,
  }
}

function toVerificationCase(id: string, value: Record<string, unknown>): VerificationCase {
  const documentTypes = Array.isArray(value.documentTypes)
    ? value.documentTypes.filter(isDocumentType)
    : []
  const checks = Array.isArray(value.checks)
    ? value.checks.map(parseCheckResult).filter((check): check is CheckResult => check !== null)
    : []

  return {
    id,
    documentTypes,
    status: parseCaseStatus(value.status),
    createdAt: value.createdAt instanceof Timestamp ? value.createdAt.toDate() : null,
    expiresAt: value.expiresAt instanceof Timestamp ? value.expiresAt.toDate() : null,
    checks,
    errorMessage: typeof value.errorMessage === 'string' ? value.errorMessage : null,
  }
}

export function subscribeToVerificationCases(
  uid: string,
  onCases: (cases: VerificationCase[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const casesQuery = query(
    collection(requireFirestore(), 'cases'),
    where('ownerUid', '==', uid),
  )

  return onSnapshot(casesQuery, (snapshot) => {
    const cases = snapshot.docs
      .map((document) => toVerificationCase(document.id, document.data()))
      .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))
    onCases(cases)
  }, onError)
}

export async function createVerificationCase(documentTypes: DocumentType[]): Promise<string> {
  const createCase = httpsCallable<
    { documentTypes: DocumentType[]; consentConfirmed: true },
    { caseId: string }
  >(
    requireFunctions(),
    'createCase',
  )
  const response = await createCase({ documentTypes, consentConfirmed: true })
  return response.data.caseId
}

export function uploadCaseDocument(
  uid: string,
  caseId: string,
  documentType: DocumentType,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  const reference = storageRef(
    requireStorage(),
    `users/${uid}/cases/${caseId}/${documentType}`,
  )
  const task = uploadBytesResumable(reference, file, {
    contentType: file.type,
    customMetadata: { documentType },
  })

  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
      reject,
      resolve,
    )
  })
}

export async function runDocumentChecks(caseId: string): Promise<void> {
  const runChecks = httpsCallable<{ caseId: string }, { checks: CheckResult[] }>(
    requireFunctions(),
    'runDocumentChecks',
    { timeout: 540_000 },
  )
  await runChecks({ caseId })
}

export async function deleteVerificationCase(caseId: string): Promise<void> {
  const deleteCase = httpsCallable<{ caseId: string }, { deleted: boolean }>(
    requireFunctions(),
    'deleteCase',
  )
  await deleteCase({ caseId })
}

export async function createVerificationReport(verificationCase: VerificationCase): Promise<void> {
  if (verificationCase.status !== 'complete' || verificationCase.checks.length === 0) {
    throw new Error('A completed document check is required to download a report.')
  }

  const { jsPDF } = await import('jspdf')
  const report = new jsPDF()
  const pageWidth = report.internal.pageSize.getWidth()
  const pageHeight = report.internal.pageSize.getHeight()
  const margin = 18
  let y = 22

  report.setFont('helvetica', 'bold')
  report.setFontSize(18)
  report.text('VeriPay document review', margin, y)
  y += 12

  report.setFont('helvetica', 'normal')
  report.setFontSize(10)
  report.text(`Case: ${verificationCase.id}`, margin, y)
  y += 6
  report.text(`Generated: ${new Date().toLocaleString()}`, margin, y)
  y += 6
  report.text(
    `Documents: ${verificationCase.documentTypes.map((type) => documentLabels[type]).join(', ')}`,
    margin,
    y,
    { maxWidth: pageWidth - margin * 2 },
  )
  y += 12

  for (const check of verificationCase.checks) {
    const lines = report.splitTextToSize(`${check.label} - ${check.status.replace('_', ' ')}`, pageWidth - margin * 2)
    const detailLines = report.splitTextToSize(check.detail, pageWidth - margin * 2)
    const blockHeight = 7 + lines.length * 5 + detailLines.length * 5
    if (y + blockHeight > pageHeight - margin) {
      report.addPage()
      y = margin
    }

    report.setFont('helvetica', 'bold')
    report.text(lines, margin, y)
    y += lines.length * 5
    report.setFont('helvetica', 'normal')
    report.text(detailLines, margin, y + 2)
    y += detailLines.length * 5 + 8
  }

  const notice = 'Advisory only. OCR can be inaccurate. Review source documents; this report is not a fraud, identity, tax, legal, or eligibility decision.'
  const noticeLines = report.splitTextToSize(notice, pageWidth - margin * 2)
  if (y + noticeLines.length * 5 > pageHeight - margin) {
    report.addPage()
    y = margin
  }
  report.setFontSize(9)
  report.text(noticeLines, margin, y)
  report.save(`VeriPay-review-${verificationCase.id}.pdf`)
}

export function getVerificationErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : ''

  switch (code) {
    case 'functions/not-found':
      return 'The document service is not deployed yet. Finish the Firebase setup before trying again.'
    case 'functions/permission-denied':
      return 'Verify your email and sign in again before uploading documents.'
    case 'functions/failed-precondition':
      return error instanceof Error ? error.message : 'This case is not ready for that action.'
    case 'storage/unauthorized':
      return 'Firebase Storage rejected this upload. Check the deployed Storage rules and try again.'
    case 'storage/unknown':
      return 'Firebase Storage is not available. Enable Storage for the VeriPay project and try again.'
    case 'functions/internal':
      return error instanceof Error ? error.message : 'Document checks failed. Check the Document AI setup and try again.'
    default:
      return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
  }
}

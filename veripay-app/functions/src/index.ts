import { DocumentProcessorServiceClient } from '@google-cloud/documentai'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { defineString } from 'firebase-functions/params'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'

initializeApp()

const db = getFirestore()
const storage = getStorage()
const documentAiLocation = defineString('DOCUMENT_AI_LOCATION')
const documentAiProcessorId = defineString('DOCUMENT_AI_PROCESSOR_ID')
const functionRegion = 'us-central1'
const retentionDays = 7
const maxFileSize = 10 * 1024 * 1024
const processingLeaseMs = 12 * 60 * 1000
const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png'])

const documentLabels = {
  payslip: 'Payslip',
  'bank-statement': 'Bank statement',
  'identity-document': 'Identity document',
} as const

type DocumentType = keyof typeof documentLabels
type CheckStatus = 'matched' | 'needs_review' | 'info'

type CheckResult = {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && Object.hasOwn(documentLabels, value)
}

function requireVerifiedUser(request: { auth?: { uid: string; token: Record<string, unknown> } | null }) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in before uploading documents.')
  }
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Verify your email before uploading documents.')
  }
  return request.auth.uid
}

function validateCaseId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'The verification case is invalid.')
  }
  return value
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractName(text: string, documentType: DocumentType): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  if (documentType === 'identity-document') {
    const surname = findLabeledValue(lines, /^(?:surname|family name)\b\s*[:-]?\s*(.*)$/i)
    const givenNames = findLabeledValue(lines, /^(?:given names|first names)\b\s*[:-]?\s*(.*)$/i)
    if (surname && givenNames) {
      return `${givenNames} ${surname}`
    }
  }

  const labelPattern = documentType === 'bank-statement'
    ? /^(?:account holder|account name|customer name|full name|name)\b\s*[:-]?\s*(.*)$/i
    : /^(?:employee name|full name|employee|name)\b\s*[:-]?\s*(.*)$/i

  return findLabeledValue(lines, labelPattern)
}

function findLabeledValue(lines: string[], pattern: RegExp): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern)
    if (!match) {
      continue
    }

    const value = (match[1] || lines[index + 1] || '').replace(/[|:;]+/g, ' ').trim()
    if (value.length >= 3 && value.length <= 100) {
      return value
    }
  }
  return null
}

function parseAmount(value: string): number | null {
  let normalized = value.replace(/\s/g, '')
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/,/g, '')
  } else if (normalized.includes(',')) {
    const decimals = normalized.length - normalized.lastIndexOf(',') - 1
    normalized = decimals === 2 ? normalized.replace(',', '.') : normalized.replace(/,/g, '')
  }

  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

function extractNetPay(text: string): number | null {
  const labelPattern = /(?:net\s+(?:pay|salary|amount)|take[-\s]?home(?:\s+pay)?|amount\s+paid)/i
  const amountPattern = /(?:R\s*)?(\d[\d\s,]*(?:[.,]\d{2})?)/i

  for (const line of text.split(/\r?\n/)) {
    if (!labelPattern.test(line)) {
      continue
    }
    const amount = line.match(amountPattern)?.[1]
    if (amount) {
      const parsed = parseAmount(amount)
      if (parsed !== null) {
        return parsed
      }
    }
  }
  return null
}

function extractSalaryDeposits(text: string): number[] {
  const deposits: number[] = []
  const currencyAmount = /R\s*(\d[\d\s,]*(?:[.,]\d{2})?)/gi

  for (const line of text.split(/\r?\n/)) {
    if (!/(salary|payroll|wage)/i.test(line)) {
      continue
    }
    for (const match of line.matchAll(currencyAmount)) {
      const amount = parseAmount(match[1])
      if (amount !== null) {
        deposits.push(amount)
      }
    }
  }
  return deposits
}

function createChecks(
  documentTypes: DocumentType[],
  extractedText: Partial<Record<DocumentType, string>>,
): CheckResult[] {
  const checks: CheckResult[] = [{
    id: 'text-extraction',
    label: 'Document text extraction',
    status: Object.values(extractedText).every((text) => Boolean(text?.trim())) ? 'info' : 'needs_review',
    detail: 'OCR text is an aid to review and may contain errors. Confirm important details against the originals.',
  }]

  if (documentTypes.length < 2) {
    checks.push({
      id: 'cross-document-name',
      label: 'Name consistency',
      status: 'info',
      detail: 'Select at least two document types to compare names across records.',
    })
  } else {
    const names = documentTypes
      .map((type) => extractedText[type] ? extractName(extractedText[type]!, type) : null)
    if (names.some((name) => !name)) {
      checks.push({
        id: 'cross-document-name',
        label: 'Name consistency',
        status: 'needs_review',
        detail: 'A name could not be confidently extracted from every selected document. Compare them manually.',
      })
    } else {
      const normalizedNames = names.map((name) => normalizeText(name!))
      const matches = normalizedNames.every((name) => name === normalizedNames[0])
      checks.push({
        id: 'cross-document-name',
        label: 'Name consistency',
        status: matches ? 'matched' : 'needs_review',
        detail: matches
          ? 'Extracted names appear consistent. Confirm them against the originals.'
          : 'Extracted names differ. Review the source documents before making a decision.',
      })
    }
  }

  if (documentTypes.includes('payslip') && documentTypes.includes('bank-statement')) {
    const netPay = extractedText.payslip ? extractNetPay(extractedText.payslip) : null
    const salaryDeposits = extractedText['bank-statement']
      ? extractSalaryDeposits(extractedText['bank-statement'])
      : []
    const matches = netPay !== null && salaryDeposits.some((deposit) => Math.abs(deposit - netPay) <= 1)

    checks.push({
      id: 'net-pay-deposit',
      label: 'Net pay and salary deposits',
      status: matches ? 'matched' : 'needs_review',
      detail: matches
        ? 'An extracted salary-labeled deposit matches the extracted net pay. Confirm the amounts and period manually.'
        : 'No clear matching salary deposit was extracted. Review the payslip and statement manually.',
    })
  }

  return checks
}

async function deleteCaseData(caseId: string, ownerUid: string): Promise<void> {
  const prefix = `users/${ownerUid}/cases/${caseId}/`
  const [files] = await storage.bucket().getFiles({ prefix })
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })))
  await db.collection('cases').doc(caseId).delete()
}

export const createCase = onCall({ region: functionRegion, maxInstances: 10 }, async (request) => {
  const uid = requireVerifiedUser(request)
  const documentTypes = request.data?.documentTypes
  if (request.data?.consentConfirmed !== true) {
    throw new HttpsError('invalid-argument', 'Confirm you have permission to submit these documents.')
  }
  if (
    !Array.isArray(documentTypes)
    || documentTypes.length < 1
    || documentTypes.length > 3
    || !documentTypes.every(isDocumentType)
    || new Set(documentTypes).size !== documentTypes.length
  ) {
    throw new HttpsError('invalid-argument', 'Choose one, two, or three different document types.')
  }

  const caseRef = db.collection('cases').doc()
  const now = Date.now()
  await caseRef.create({
    ownerUid: uid,
    documentTypes,
    status: 'uploading',
    consentConfirmed: true,
    consentConfirmedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(now + retentionDays * 24 * 60 * 60 * 1000),
  })

  return { caseId: caseRef.id }
})

export const runDocumentChecks = onCall(
  { region: functionRegion, memory: '2GiB', timeoutSeconds: 540, maxInstances: 5 },
  async (request) => {
    const uid = requireVerifiedUser(request)
    const caseId = validateCaseId(request.data?.caseId)
    const caseRef = db.collection('cases').doc(caseId)
    const processState = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(caseRef)
      const data = snapshot.data()
      if (!snapshot.exists || !data || data.ownerUid !== uid) {
        throw new HttpsError('not-found', 'The verification case was not found.')
      }

      if (data.status === 'complete' && Array.isArray(data.checks)) {
        return { alreadyComplete: true as const, checks: data.checks }
      }

      if (data.status === 'processing') {
        const processingStartedAt = data.processingStartedAt
        if (
          processingStartedAt instanceof Timestamp
          && Timestamp.now().toMillis() - processingStartedAt.toMillis() < processingLeaseMs
        ) {
          throw new HttpsError('already-exists', 'This case is already being checked.')
        }
      } else if (data.status !== 'uploading' && data.status !== 'failed') {
        throw new HttpsError('failed-precondition', 'This case cannot be processed in its current state.')
      }

      const documentTypes = data.documentTypes
      if (!Array.isArray(documentTypes) || !documentTypes.every(isDocumentType)) {
        throw new HttpsError('failed-precondition', 'The selected document types are invalid.')
      }
      const selectedDocumentTypes: DocumentType[] = documentTypes.filter(isDocumentType)

      transaction.update(caseRef, {
        status: 'processing',
        processingStartedAt: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
        errorMessage: FieldValue.delete(),
      })
      return { alreadyComplete: false as const, documentTypes: selectedDocumentTypes }
    })

    if (processState.alreadyComplete) {
      return { checks: processState.checks }
    }

    const { documentTypes } = processState

    try {
      const location = documentAiLocation.value()
      const processorId = documentAiProcessorId.value()
      const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
      if (!projectId || !/^[A-Za-z0-9-]+$/.test(processorId)) {
        throw new Error('Document AI project or processor configuration is missing.')
      }

      const client = new DocumentProcessorServiceClient({
        apiEndpoint: `${location}-documentai.googleapis.com`,
      })
      const bucket = storage.bucket()
      const extractedText: Partial<Record<DocumentType, string>> = {}

      for (const documentType of documentTypes) {
        const path = `users/${uid}/cases/${caseId}/${documentType}`
        const file = bucket.file(path)
        const [exists] = await file.exists()
        if (!exists) {
          throw new HttpsError('failed-precondition', `The ${documentLabels[documentType]} upload is missing.`)
        }

        const [metadata] = await file.getMetadata()
        if (
          !allowedMimeTypes.has(String(metadata.contentType))
          || Number(metadata.size) <= 0
          || Number(metadata.size) > maxFileSize
        ) {
          throw new HttpsError('failed-precondition', `The ${documentLabels[documentType]} file is not supported.`)
        }

        const [contents] = await file.download()
        const [response] = await client.processDocument({
          name: `projects/${projectId}/locations/${location}/processors/${processorId}`,
          rawDocument: {
            content: contents,
            mimeType: String(metadata.contentType),
          },
        })
        extractedText[documentType] = response.document?.text || ''
      }

      const checks = createChecks(documentTypes, extractedText)
      await caseRef.update({
        status: 'complete',
        checks,
        processingStartedAt: FieldValue.delete(),
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { checks }
    } catch (error) {
      logger.error('Document processing failed.', { caseId, uid, error })
      await caseRef.update({
        status: 'failed',
        errorMessage: 'Document checks could not be completed. Review the setup and try again.',
        processingStartedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      if (error instanceof HttpsError) {
        throw error
      }
      throw new HttpsError(
        'internal',
        'Document checks could not be completed. Review the processor setup and try again.',
      )
    }
  },
)

export const deleteCase = onCall({ region: functionRegion, maxInstances: 10 }, async (request) => {
  const uid = requireVerifiedUser(request)
  const caseId = validateCaseId(request.data?.caseId)
  const caseRef = db.collection('cases').doc(caseId)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(caseRef)
    const data = snapshot.data()
    if (!snapshot.exists || !data || data.ownerUid !== uid) {
      throw new HttpsError('not-found', 'The verification case was not found.')
    }
    if (
      data.status === 'processing'
      && data.processingStartedAt instanceof Timestamp
      && Timestamp.now().toMillis() - data.processingStartedAt.toMillis() < processingLeaseMs
    ) {
      throw new HttpsError('failed-precondition', 'Wait for document checks to finish before deleting this case.')
    }
    transaction.update(caseRef, {
      status: 'deleting',
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  await deleteCaseData(caseId, uid)
  return { deleted: true }
})

export const purgeExpiredCases = onSchedule(
  { schedule: 'every 60 minutes', region: functionRegion, maxInstances: 1 },
  async () => {
    const expiredCases = await db.collection('cases')
      .where('expiresAt', '<=', Timestamp.now())
      .limit(100)
      .get()

    for (const snapshot of expiredCases.docs) {
      const ownerUid = snapshot.data().ownerUid
      if (typeof ownerUid !== 'string') {
        logger.error('Expired case has no owner and could not be deleted.', { caseId: snapshot.id })
        continue
      }
      try {
        const canDelete = await db.runTransaction(async (transaction) => {
          const current = await transaction.get(snapshot.ref)
          const data = current.data()
          if (!current.exists || !data || data.ownerUid !== ownerUid) {
            return false
          }
          if (
            data.status === 'processing'
            && data.processingStartedAt instanceof Timestamp
            && Timestamp.now().toMillis() - data.processingStartedAt.toMillis() < processingLeaseMs
          ) {
            return false
          }
          transaction.update(snapshot.ref, {
            status: 'deleting',
            updatedAt: FieldValue.serverTimestamp(),
          })
          return true
        })
        if (!canDelete) {
          continue
        }
        await deleteCaseData(snapshot.id, ownerUid)
      } catch (error) {
        logger.error('Could not delete an expired case.', { caseId: snapshot.id, error })
      }
    }
  },
)

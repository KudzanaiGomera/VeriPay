# VeriPay

VeriPay lets verified users submit payslips, bank statements, and identity documents for advisory text extraction and cross-document checks. Users can review their cases, download a PDF summary, or delete a case and its uploaded files. Reports are generated in the browser and are not emailed or stored.

Checks are not fraud, identity, tax, legal, or eligibility decisions. OCR can be inaccurate; review results against the original documents.

## Local web app

Use Node.js 20 or newer. From this folder:

```bash
npm install
copy .env.example .env
npm run dev
```

In `.env`, add the web app values from Firebase Project settings:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=veripay-3d34e.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=veripay-3d34e
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

In Firebase Authentication, enable Email/Password and Google sign-in. Email/password accounts must verify their email before using document features. Add the deployed domain under Authentication → Settings → Authorized domains.

## Enable document reviews

The client and backend configuration is in this repository, but uploads and OCR will not work until the following Firebase and Google Cloud services are enabled and deployed. Functions, scheduled cleanup, Storage, and Document AI may require a billing-enabled Google Cloud project and incur charges.

1. In project `veripay-3d34e`, create a Firestore database and enable Firebase Storage.
2. Enable the Document AI API. Create a Document AI processor that supports text extraction for PDF, JPEG, and PNG documents. Note its processor location and ID.
3. Configure the Functions parameters. Copy `functions/.env.example` to `functions/.env.veripay-3d34e`, then set the processor location and ID:

   ```env
   DOCUMENT_AI_LOCATION=us
   DOCUMENT_AI_PROCESSOR_ID=your-processor-id
   ```

   The location must match the processor's location (for example, `us` or `eu`).
4. Grant the Cloud Functions runtime service account access to process documents and manage case data. It needs Document AI API User (`roles/documentai.apiUser`), Storage Object Admin (`roles/storage.objectAdmin`) on the Firebase bucket, and Datastore User (`roles/datastore.user`) for Firestore. Use the least scope available for each grant.
5. Install the Firebase CLI if needed, authenticate, select the project, and deploy the rules and functions:

   ```bash
   firebase login
   firebase use veripay-3d34e
   firebase deploy --only firestore:rules,storage,functions
   ```

   Deployment sets up the callable functions and an hourly cleanup job. Files are scheduled for deletion after 7 days; the hourly job means cleanup can occur up to about an hour after that time. A scheduled job requires the relevant Google Cloud APIs and billing.

6. Add the Firebase web app values to `.env`, restart the web app, sign in with a verified account, and submit a small test file.

The Firestore and Storage rules in this repository deny browser writes, restrict reads to the verified owner, and allow only the selected PDF/JPEG/PNG uploads up to 10 MB per file. Functions perform processing and deletion with the Admin SDK. Keep service-account keys and private credentials out of the web app and repository.

## Data handling

- Document contents are sent to Google Document AI for text extraction after submission.
- OCR text is used to calculate advisory results and is not stored in the case record. Case metadata and check summaries are stored in Firestore.
- Uploaded files are private and are scheduled for deletion after 7 days. A user can request immediate case and file deletion in the dashboard.
- The PDF report is generated locally in the user's browser from the saved check summary.
- Automated results can be wrong or incomplete. A person must review source documents and make any consequential decision.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm --prefix functions run build
```

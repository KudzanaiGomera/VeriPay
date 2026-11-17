import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { requireAuth } from '../../lib/firebase'

export async function registerWithEmail(name: string, email: string, password: string) {
  const auth = requireAuth()
  await setPersistence(auth, browserLocalPersistence)
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  await updateProfile(credential.user, { displayName: name })
  await sendEmailVerification(credential.user)
  return credential.user
}

export async function signInWithEmail(email: string, password: string) {
  const auth = requireAuth()
  await setPersistence(auth, browserLocalPersistence)
  const credential = await signInWithEmailAndPassword(auth, email, password)
  return credential.user
}

export async function signInWithGoogle() {
  const auth = requireAuth()
  await setPersistence(auth, browserLocalPersistence)
  const credential = await signInWithPopup(auth, new GoogleAuthProvider())
  return credential.user
}

export async function sendPasswordReset(email: string) {
  await sendPasswordResetEmail(requireAuth(), email)
}

export async function signOutUser() {
  await signOut(requireAuth())
}

export function getAuthErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : ''

  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email already has an account. Try signing in instead.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'The email or password is incorrect.'
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 8 characters.'
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in Firebase Authentication yet.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Allow pop-ups for this site and try again.'
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was closed before completion. Try again.'
    case 'auth/cancelled-popup-request':
      return 'Another Google sign-in request is already in progress.'
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Firebase Authentication. Add it under Authentication settings.'
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists for this email with a different sign-in method. Sign in with that method first.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a little and try again.'
    case 'auth/network-request-failed':
      return 'Could not connect to Firebase. Check your internet connection.'
    default:
      return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
  }
}

import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { ServiceAccount } from 'firebase-admin/app';

type ServiceAccountConfig = {
  project_id: string;
  client_email: string;
  private_key: string;
  [key: string]: unknown;
};

let firebaseApp: App | undefined;

function getServiceAccountConfig(): ServiceAccountConfig {
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;

  const payload = base64
    ? Buffer.from(base64, 'base64').toString('utf-8')
    : json;

  if (!payload) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_BASE64 atau FIREBASE_SERVICE_ACCOUNT belum diset di environment.'
    );
  }

  return JSON.parse(payload);
}

export function initFirebaseAdmin() {
  if (!firebaseApp) {
    if (getApps().length > 0) {
      firebaseApp = getApps()[0];
    } else {
      const credentials = getServiceAccountConfig();
      firebaseApp = initializeApp({
        credential: cert(credentials as ServiceAccount),
      });
    }
  }

  return firebaseApp;
}

export function getFirestoreDb() {
  initFirebaseAdmin();
  return getFirestore();
}

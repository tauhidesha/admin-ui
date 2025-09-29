import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, DocumentData } from 'firebase-admin/firestore';
import { normalizeSenderNumber as normalizeIdentitySender } from './identity';

export interface SnoozeInfo {
  active: boolean;
  manual: boolean;
  durationMinutes: number | null;
  expiresAt: string | null;
  reason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export const normalizeSenderNumber = normalizeIdentitySender;

export async function setSnoozeMode(
  db: Firestore,
  senderNumber: string,
  durationMinutes = 60,
  options: { manual?: boolean; reason?: string } = {}
) {
  const { manual = false, reason = null } = options;
  const docRef = db.collection('handoverSnoozes').doc(senderNumber);

  let effectiveDuration: number | null = null;
  let expiresAtValue: Timestamp | null = null;

  if (!manual) {
    effectiveDuration = typeof durationMinutes === 'number' && durationMinutes > 0 ? durationMinutes : 60;
    const expiresAtDate = new Date(Date.now() + effectiveDuration * 60 * 1000);
    expiresAtValue = Timestamp.fromDate(expiresAtDate);
  }

  const payload: DocumentData = {
    senderNumber,
    durationMinutes: effectiveDuration,
    manual,
    reason: reason || null,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };

  if (manual) {
    payload.expiresAt = null;
  } else if (expiresAtValue) {
    payload.expiresAt = expiresAtValue;
  }

  await docRef.set(payload, { merge: true });
}

export async function clearSnoozeMode(db: Firestore, senderNumber: string) {
  await db.collection('handoverSnoozes').doc(senderNumber).delete();
}

export async function getSnoozeInfo(
  db: Firestore,
  senderNumber: string,
  options: { cleanExpired?: boolean } = {}
): Promise<SnoozeInfo> {
  const { cleanExpired = false } = options;
  const docRef = db.collection('handoverSnoozes').doc(senderNumber);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return {
      active: false,
      manual: false,
      durationMinutes: null,
      expiresAt: null,
      reason: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  const data = snapshot.data() || {};
  const manual = Boolean(data.manual);
  const expiresAtDate = data.expiresAt?.toDate ? (data.expiresAt.toDate() as Date) : null;
  const now = new Date();

  let active = manual;

  if (!manual) {
    if (expiresAtDate && expiresAtDate > now) {
      active = true;
    } else {
      active = false;
      if (cleanExpired) {
        await docRef.delete().catch(() => undefined);
      }
    }
  }

  return {
    active,
    manual,
    durationMinutes: typeof data.durationMinutes === 'number' ? data.durationMinutes : null,
    expiresAt: expiresAtDate ? expiresAtDate.toISOString() : null,
    reason: (data.reason as string) || null,
    createdAt: data.createdAt?.toDate ? (data.createdAt.toDate() as Date).toISOString() : null,
    updatedAt: data.updatedAt?.toDate ? (data.updatedAt.toDate() as Date).toISOString() : null,
  };
}

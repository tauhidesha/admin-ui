import { NextResponse } from 'next/server';
import type { Timestamp } from 'firebase-admin/firestore';
import { getFirestoreDb } from '@/lib/firebaseAdmin';
import { getSnoozeInfo, normalizeSenderNumber } from '@/lib/snooze';
import { parseSenderIdentity } from '@/lib/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeTimestamp(timestamp: Timestamp | Date | null | undefined) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  if ('toDate' in timestamp && typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString();
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : 100;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100;

    const db = getFirestoreDb();
    const snapshot = await db.collection('directMessages').get();

    const conversations = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const data = doc.data() || {};
        const updatedAt = serializeTimestamp(data.updatedAt);
        const lastMessageAt = serializeTimestamp(data.lastMessageAt);
        const identity = parseSenderIdentity(doc.id);
        const effectiveChannel = (data.channel as string) && data.channel !== 'unknown'
          ? String(data.channel)
          : identity.channel;
        const platformId = (data.platformId as string) || identity.platformId || identity.docId;
        const snoozeInfo = await getSnoozeInfo(db, normalizeSenderNumber(doc.id));

        return {
          id: doc.id,
          senderNumber: doc.id,
          name: data.name || null,
          lastMessage: data.lastMessage || null,
          lastMessageSender: data.lastMessageSender || null,
          lastMessageAt,
          updatedAt,
          messageCount: typeof data.messageCount === 'number' ? data.messageCount : null,
          channel: effectiveChannel,
          platformId,
          aiPaused: snoozeInfo.active,
          aiPausedUntil: snoozeInfo.expiresAt,
          aiPausedManual: snoozeInfo.manual,
          aiPausedReason: snoozeInfo.reason,
        };
      })
    );

    conversations.sort((a, b) => {
      const timeA = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const timeB = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return timeB - timeA;
    });

    const limited = conversations.slice(0, limit);

    return NextResponse.json({ conversations: limited, count: limited.length, status: 'success' });
  } catch (error) {
    console.error('[admin-ui] Failed to fetch conversations:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

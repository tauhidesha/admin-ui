import { NextResponse } from 'next/server';
import type { Timestamp } from 'firebase-admin/firestore';
import { getFirestoreDb } from '@/lib/firebaseAdmin';
import { getSnoozeInfo, normalizeSenderNumber } from '@/lib/snooze';
import { parseSenderIdentity } from '@/lib/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeTimestamp(timestamp: Timestamp | null | undefined) {
  if (!timestamp) return null;
  return {
    seconds: timestamp.seconds,
    nanoseconds: timestamp.nanoseconds,
  };
}

export async function GET(
  request: Request,
  { params }: { params: { number: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : 200;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 200;

    const rawNumber = params.number;
    const identity = parseSenderIdentity(rawNumber);

    if (!identity.docId) {
      return NextResponse.json({ error: 'Nomor pelanggan tidak valid.' }, { status: 400 });
    }

    const docId = identity.docId;
    const db = getFirestoreDb();
    const messagesRef = db.collection('directMessages').doc(docId).collection('messages');

    const snapshot = await messagesRef.orderBy('timestamp', 'desc').limit(limit).get();

    const history = snapshot.docs.map((doc) => {
      const data = doc.data();
      const timestamp = serializeTimestamp(data.timestamp as Timestamp | undefined);

      return {
        text: data.text || '',
        sender: data.sender || 'user',
        timestamp,
      };
    });

    history.reverse();

    const snoozeInfo = await getSnoozeInfo(db, normalizeSenderNumber(identity.normalizedAddress));

    return NextResponse.json({
      senderNumber: identity.docId,
      channel: identity.channel,
      platformId: identity.platformId,
      messageCount: history.length,
      history,
      aiPaused: snoozeInfo.active,
      aiPauseInfo: snoozeInfo,
      status: 'success',
    });
  } catch (error) {
    console.error('[admin-ui] Failed to fetch conversation history:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

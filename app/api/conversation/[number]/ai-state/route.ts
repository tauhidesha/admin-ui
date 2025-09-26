import { NextResponse } from 'next/server';
import { getFirestoreDb } from '@/lib/firebaseAdmin';
import {
  clearSnoozeMode,
  getSnoozeInfo,
  normalizeSenderNumber,
  setSnoozeMode,
} from '@/lib/snooze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { number: string } }
) {
  try {
    const rawNumber = params.number;
    const numeric = rawNumber.replace(/[^0-9]/g, '');
    if (!numeric) {
      return NextResponse.json({ error: 'Nomor tidak valid.' }, { status: 400 });
    }

    const senderNumber = normalizeSenderNumber(numeric);

    const db = getFirestoreDb();
    const info = await getSnoozeInfo(db, senderNumber);

    return NextResponse.json({
      senderNumber,
      aiPaused: info.active,
      aiPauseInfo: info,
      status: 'success',
    });
  } catch (error) {
    console.error('[admin-ui] Failed to fetch AI state:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { number: string } }
) {
  try {
    const rawNumber = params.number;
    const body = await request.json().catch(() => ({}));
    const { enabled, durationMinutes, reason } = body || {};

    if (!rawNumber) {
      return NextResponse.json({ error: 'Number is required.' }, { status: 400 });
    }

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled (boolean) is required.' }, { status: 400 });
    }

    const numeric = rawNumber.replace(/[^0-9]/g, '');
    if (!numeric) {
      return NextResponse.json({ error: 'Nomor tidak valid.' }, { status: 400 });
    }

    const senderNumber = normalizeSenderNumber(numeric);
    const db = getFirestoreDb();

    if (enabled) {
      await clearSnoozeMode(db, senderNumber).catch(() => undefined);
    } else {
      const hasDuration = typeof durationMinutes === 'number' && durationMinutes > 0;
      const manual = !hasDuration;
      const effectiveDuration = hasDuration ? durationMinutes : 60;
      await setSnoozeMode(db, senderNumber, effectiveDuration, {
        manual,
        reason: reason || (manual ? 'manual-toggle' : 'timed-toggle'),
      });
    }

    const info = await getSnoozeInfo(db, senderNumber);

    return NextResponse.json({
      senderNumber,
      aiPaused: info.active,
      aiPauseInfo: info,
      status: 'success',
    });
  } catch (error) {
    console.error('[admin-ui] Failed to update AI state:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

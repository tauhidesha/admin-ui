import { NextResponse } from 'next/server';

const backendBase = [
  process.env.API_BASE_URL,
  process.env.NEXT_PUBLIC_API_BASE_URL,
]
  .find((value) => typeof value === 'string' && value.trim().length > 0)
  ?.replace(/\/$/, '');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { number, message } = payload ?? {};

    if (!number || typeof number !== 'string') {
      return NextResponse.json(
        { error: 'Parameter "number" wajib diisi.' },
        { status: 400 }
      );
    }

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Parameter "message" wajib diisi.' },
        { status: 400 }
      );
    }

    if (!backendBase) {
      return NextResponse.json(
        { error: 'API backend belum dikonfigurasi.' },
        { status: 500 }
      );
    }

    const targetUrl = `${backendBase}/send-message`;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, message }),
    });

    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const raw = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const errorMessage =
        typeof raw === 'string' ? raw : raw?.error || 'Gagal mengirim pesan ke backend.';
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }

    if (typeof raw === 'string') {
      return NextResponse.json({ success: true, message: raw });
    }

    return NextResponse.json(raw);
  } catch (error) {
    console.error('[admin-ui] Failed to proxy send-message:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Terjadi kesalahan internal.' },
      { status: 500 }
    );
  }
}

'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import useSWR from 'swr';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

const buildApiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Langsung gunakan API_BASE jika ada. Jangan fallback ke /api karena tidak ada proxy.
  if (API_BASE) {
    // Fix: Jika user lupa menulis https://, kita tambahkan otomatis agar tidak dianggap relative path
    if (!API_BASE.startsWith('http')) {
      return `https://${API_BASE}${normalizedPath}`;
    }
    return `${API_BASE}${normalizedPath}`;
  }

  return `/api${normalizedPath}`;
};

const fetcher = async (url: string) => {
  console.log(`[Fetcher] Requesting: ${url}`);
  const res = await fetch(url, {
    headers: {
      'ngrok-skip-browser-warning': 'true',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    // Deteksi jika respons adalah HTML (biasanya 404 Not Found atau 500 Error dari server web)
    if (text.trim().startsWith('<')) {
      throw new Error(`Backend tidak dapat dihubungi (${res.status}). Cek konfigurasi NEXT_PUBLIC_API_BASE_URL.`);
    }
    try {
      const parsed = JSON.parse(text);
      throw new Error(parsed.error || text);
    } catch (error) {
      if (error instanceof Error && error.message !== text) {
        throw error;
      }
      throw new Error(text);
    }
  }
  return res.json();
};

interface FirestoreTimestamp {
  seconds: number;
  nanoseconds?: number;
}

interface ConversationMessage {
  text: string;
  sender: 'ai' | 'user' | 'admin';
  timestamp?: FirestoreTimestamp | string | null;
}

interface AiPauseInfo {
  active: boolean;
  manual: boolean;
  durationMinutes: number | null;
  expiresAt: string | null;
  reason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ConversationResponse {
  senderNumber: string;
  messageCount: number;
  history: ConversationMessage[];
  aiPaused?: boolean;
  aiPauseInfo?: AiPauseInfo;
  channel?: string | null;
  platformId?: string | null;
}

interface ConversationSummary {
  id: string;
  senderNumber: string;
  name: string | null;
  lastMessage: string | null;
  lastMessageSender: string | null;
  lastMessageAt: string | null;
  updatedAt: string | null;
  messageCount: number | null;
  aiPaused?: boolean;
  aiPausedUntil?: string | null;
  aiPausedManual?: boolean;
  aiPausedReason?: string | null;
  channel?: string | null;
  platformId?: string | null;
}

interface ConversationListResponse {
  conversations: ConversationSummary[];
  count: number;
}

interface NotificationItem {
  id: string;
  senderNumber: string;
  name: string | null;
  preview: string;
  timestamp: string | null;
}

interface Booking {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceName?: string;
  services?: string[];
  bookingDate: string;
  bookingTime: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  adminNotes?: string;
  isRepaint?: boolean;
  estimatedDurationDays?: number;
  estimatedEndDate?: string;
}

function formatTimestamp(ts?: FirestoreTimestamp | string | null) {
  if (!ts) return '';

  let date: Date;

  if (typeof ts === 'string') {
    date = new Date(ts);
  } else if (typeof ts === 'object' && typeof ts.seconds === 'number') {
    const milliseconds = ts.seconds * 1000 + (ts.nanoseconds ?? 0) / 1_000_000;
    date = new Date(milliseconds);
  } else {
    return '';
  }

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('id-ID', { hour12: false });
}

function formatIsoTimestamp(iso?: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('id-ID', { hour12: false });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatWhatsappText(text: string) {
  const escaped = escapeHtml(text);
  const withLineBreaks = escaped.replace(/\n/g, '<br />');
  const withBold = withLineBreaks.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
  const withItalic = withBold.replace(/_(.*?)_/g, '<em>$1</em>');
  const withStrike = withItalic.replace(/~(.*?)~/g, '<s>$1</s>');
  return { __html: withStrike };
}

const CHANNEL_META: Record<string, { label: string; tag: string; pillClass: string }> = {
  whatsapp: { label: 'WhatsApp', tag: 'WA', pillClass: 'pill-channel--whatsapp' },
  messenger: { label: 'Messenger', tag: 'Messenger', pillClass: 'pill-channel--messenger' },
  instagram: { label: 'Instagram DM', tag: 'Instagram', pillClass: 'pill-channel--instagram' },
};

const DEFAULT_CHANNEL_META = { label: 'Unknown', tag: 'Unknown', pillClass: 'pill-channel--unknown' };

function normalizeChannelKey(channel?: string | null) {
  if (!channel) return 'whatsapp';
  const lower = channel.toLowerCase();
  const [key] = lower.split(':');
  return key || 'unknown';
}

function getChannelMeta(channel?: string | null) {
  const key = normalizeChannelKey(channel);
  return CHANNEL_META[key] || DEFAULT_CHANNEL_META;
}

type ConversationLike = {
  name?: string | null;
  senderNumber: string;
  platformId?: string | null;
  channel?: string | null;
};

function getConversationDisplayName(conversation: ConversationLike | null | undefined) {
  if (!conversation) return '';
  const name = conversation.name?.trim();
  const senderId = conversation.senderNumber;
  const platformId = conversation.platformId?.trim();
  if (name && name !== senderId && (!platformId || name !== platformId)) {
    return name;
  }

  const channelKey = normalizeChannelKey(conversation.channel);
  if (channelKey !== 'whatsapp' && conversation.platformId) {
    return conversation.platformId;
  }

  return conversation.senderNumber;
}

type ViewMode = 'chat' | 'calendar';

export default function AdminConsole() {
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [selectedNumber, setSelectedNumber] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isTogglingAi, setIsTogglingAi] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileContent, setShowMobileContent] = useState(false);
  const canSendMessages = Boolean(API_BASE);

  const {
    data: listData,
    error: listError,
    mutate: mutateConversations,
    isValidating: isLoadingList,
  } = useSWR<ConversationListResponse>(buildApiUrl('/conversations'), fetcher, {
    refreshInterval: 15000,
  });

  const shouldFetchHistory = Boolean(selectedNumber);
  const {
    data: historyData,
    error: historyError,
    mutate: mutateHistory,
    isValidating: isLoadingHistory,
  } = useSWR<ConversationResponse>(
    shouldFetchHistory ? buildApiUrl(`/conversation-history/${selectedNumber}`) : null,
    fetcher,
    { refreshInterval: 15000 }
  );

  // Fetch Bookings
  const { data: bookingsData, mutate: mutateBookings } = useSWR<{ bookings: Booking[] }>(
    viewMode === 'calendar' ? buildApiUrl('/bookings') : null,
    fetcher
  );

  useEffect(() => {
    if (!listData?.conversations?.length) return;
    if (selectedNumber) return;

    if (isMobile) {
      setShowMobileContent(false);
      return;
    }

    setSelectedNumber(listData.conversations[0].senderNumber);
  }, [isMobile, listData, selectedNumber]);

  useEffect(() => {
    const updateViewport = () => {
      const mobile = typeof window !== 'undefined' && window.innerWidth <= 900;
      setIsMobile(mobile);
      if (!mobile) {
        setShowMobileContent(true);
      } else if (!selectedNumber) {
        setShowMobileContent(false);
      }
    };

    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, [selectedNumber]);

  const hasInitializedConversationsRef = useRef(false);
  const previousCountsRef = useRef<Record<string, number>>({});
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!listData?.conversations) {
      return;
    }

    const previousCounts = previousCountsRef.current;
    const nextCounts: Record<string, number> = {};
    const newNotifications: NotificationItem[] = [];

    listData.conversations.forEach((conversation) => {
      const count = conversation.messageCount ?? 0;
      nextCounts[conversation.senderNumber] = count;

      if (!hasInitializedConversationsRef.current) {
        return;
      }

      const previousCount = previousCounts[conversation.senderNumber] ?? 0;
      const hasNewMessage = count > previousCount;
      const isFromUser = (conversation.lastMessageSender || 'user') === 'user';
      const isSelected = conversation.senderNumber === selectedNumber;

      if (hasNewMessage && isFromUser && !isSelected) {
        newNotifications.push({
          id: `${conversation.senderNumber}-${Date.now()}`,
          senderNumber: conversation.senderNumber,
          name: conversation.name || null,
          preview: conversation.lastMessage || 'Pesan baru',
          timestamp: conversation.lastMessageAt,
        });
      }
    });

    previousCountsRef.current = nextCounts;
    hasInitializedConversationsRef.current = true;

    if (newNotifications.length) {
      setNotifications((prev) => [...prev, ...newNotifications]);
    }

    if (selectedNumber) {
      setNotifications((prev) => {
        const filtered = prev.filter((item) => item.senderNumber !== selectedNumber);
        return filtered.length === prev.length ? prev : filtered;
      });
    }
  }, [listData, selectedNumber]);

  useEffect(() => {
    if (isMobile && selectedNumber) {
      setShowMobileContent(true);
    }
  }, [isMobile, selectedNumber]);

  const filteredConversations = useMemo(() => {
    if (!listData?.conversations?.length) return [];
    if (!searchTerm.trim()) return listData.conversations;

    const keyword = searchTerm.trim().toLowerCase();
    return listData.conversations.filter((conversation) => {
      const numberMatch = conversation.senderNumber.toLowerCase().includes(keyword);
      const nameMatch = conversation.name?.toLowerCase().includes(keyword);
      const messageMatch = conversation.lastMessage?.toLowerCase().includes(keyword);
      return numberMatch || nameMatch || messageMatch;
    });
  }, [listData, searchTerm]);

  const activeConversation = useMemo(() => {
    if (!selectedNumber || !listData?.conversations) return null;
    return listData.conversations.find((conversation) => conversation.senderNumber === selectedNumber) || null;
  }, [listData, selectedNumber]);

  const activeChannelMeta = useMemo(
    () => getChannelMeta(activeConversation?.channel ?? activeConversation?.senderNumber),
    [activeConversation?.channel, activeConversation?.senderNumber]
  );

  const activeChannelKey = normalizeChannelKey(
    activeConversation?.channel ?? activeConversation?.senderNumber
  );
  const isWhatsappConversation = activeChannelKey === 'whatsapp';
  const isSupportedChannel = ['whatsapp', 'instagram', 'messenger'].includes(activeChannelKey);

  const handleSelectConversation = useCallback(
    (senderNumber: string) => {
      setSelectedNumber(senderNumber);
      setNotifications((prev) => {
        const filtered = prev.filter((item) => item.senderNumber !== senderNumber);
        return filtered.length === prev.length ? prev : filtered;
      });
      if (isMobile) {
        setShowMobileContent(true);
      }
    },
    [isMobile]
  );

  const aiPaused = historyData?.aiPaused ?? false;
  const aiPauseInfo = historyData?.aiPauseInfo;

  const aiStatusDescription = useMemo(() => {
    if (!aiPaused) {
      return 'AI aktif';
    }

    const segments: string[] = [];

    if (aiPauseInfo?.manual) {
      segments.push('AI dimatikan manual');
    } else {
      segments.push('AI dijeda sementara');
    }

    if (aiPauseInfo?.expiresAt) {
      const formatted = formatIsoTimestamp(aiPauseInfo.expiresAt);
      if (formatted) {
        segments.push(`hingga ${formatted}`);
      }
    }

    if (aiPauseInfo?.reason) {
      const friendlyReason = (() => {
        switch (aiPauseInfo.reason) {
          case 'admin-ui-toggle':
            return 'admin UI';
          case 'manual-toggle':
            return 'manual';
          case 'timed-toggle':
            return 'otomatis';
          default:
            return aiPauseInfo.reason;
        }
      })();
      segments.push(`alasan: ${friendlyReason}`);
    }

    return segments.join(' · ') || 'AI dijeda';
  }, [aiPaused, aiPauseInfo]);

  const handleSendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed || !selectedNumber) return;
    if (!canSendMessages) {
      alert('Pengiriman pesan membutuhkan konfigurasi NEXT_PUBLIC_API_BASE_URL yang mengarah ke backend.');
      return;
    }
    if (!isSupportedChannel) {
      alert('Balasan untuk kanal ini belum didukung dari admin UI.');
      return;
    }

    setIsSending(true);
    try {
      const sendMessageUrl = buildApiUrl('/send-message');
      const payload = {
        number: selectedNumber,
        message: trimmed,
        channel: activeConversation?.channel ?? activeChannelKey,
        platformId: activeConversation?.platformId || null,
      };

      const res = await fetch(sendMessageUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const parsed = JSON.parse(text);
          throw new Error(parsed.error || text);
        } catch (error) {
          if (error instanceof Error && error.message !== text) {
            throw error;
          }
          throw new Error(text);
        }
      }

      setMessage('');
      await Promise.all([mutateHistory(), mutateConversations()]);
    } catch (err) {
      console.error('[AdminConsole] Gagal mengirim pesan:', err);
      alert('Gagal mengirim pesan. Cek log server.');
    } finally {
      setIsSending(false);
    }
  };

  const renderConversationItem = useCallback(
    (conversation: ConversationSummary) => {
      const isActive = conversation.senderNumber === selectedNumber;
      const displayName = getConversationDisplayName(conversation);
      const subtitle = conversation.lastMessage || 'Belum ada pesan';
      const timestamp = conversation.lastMessageAt || conversation.updatedAt;
      const formattedTimestamp = formatIsoTimestamp(timestamp);
      const isPaused = conversation.aiPaused ?? false;
      const hasNotification = notifications.some((item) => item.senderNumber === conversation.senderNumber);
      const channelMeta = getChannelMeta(conversation.channel ?? conversation.senderNumber);

      return (
        <button
          key={conversation.senderNumber}
          type="button"
          className={`conversation-item${isActive ? ' active' : ''}${hasNotification ? ' new-message' : ''}`}
          onClick={() => handleSelectConversation(conversation.senderNumber)}
        >
          <div className="conversation-item__header">
            <div className="conversation-item__title">
              <span className="conversation-item__name">{displayName}</span>
              <span
                className={`pill pill-channel ${channelMeta.pillClass}`}
                title={channelMeta.label}
              >
                {channelMeta.tag}
              </span>
              {isPaused && <span className="pill pill-warning">AI OFF</span>}
            </div>
            {formattedTimestamp ? (
              <span className="conversation-item__time">{formattedTimestamp}</span>
            ) : (
              <span className="conversation-item__time muted">—</span>
            )}
          </div>
          <div className="conversation-item__subtitle">{subtitle}</div>
        </button>
      );
    },
    [handleSelectConversation, notifications, selectedNumber]
  );

  const handleToggleAi = async () => {
    if (!selectedNumber) return;

    setIsTogglingAi(true);
    try {
      const url = buildApiUrl(`/conversation/${selectedNumber}/ai-state`);
      const payload = {
        enabled: aiPaused,
        reason: 'admin-ui-toggle',
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const parsed = JSON.parse(text);
          throw new Error(parsed.error || text);
        } catch (error) {
          if (error instanceof Error && error.message !== text) {
            throw error;
          }
          throw new Error(text);
        }
      }

      await Promise.all([mutateHistory(), mutateConversations()]);
    } catch (err) {
      console.error('[AdminConsole] Gagal memperbarui status AI:', err);
      alert('Gagal memperbarui status AI. Coba lagi.');
    } finally {
      setIsTogglingAi(false);
    }
  };

  const toggleButtonLabel = isTogglingAi
    ? 'Memproses...'
    : aiPaused
    ? 'Aktifkan AI'
    : 'Matikan AI';

  const toggleButtonClassName = aiPaused
    ? 'toggle-button toggle-button--resume'
    : 'toggle-button toggle-button--pause';
  const mobileToggleClassName = `${toggleButtonClassName} toggle-button--mobile`;
  const mobileToggleLabel = isTogglingAi ? '...' : aiPaused ? 'AI ON' : 'AI OFF';

  const getSenderLabel = useCallback((sender: ConversationMessage['sender']) => {
    switch (sender) {
      case 'ai':
        return 'Zoya (AI)';
      case 'admin':
        return 'Admin';
      default:
        return getConversationDisplayName(activeConversation) || 'Pelanggan';
    }
  }, [activeConversation]);

  useEffect(() => {
    const textarea = messageInputRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 44), 160);
    textarea.style.height = `${nextHeight}px`;
  }, [message]);

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isUpdatingBooking, setIsUpdatingBooking] = useState(false);
  const [bookingNote, setBookingNote] = useState('');

  return (
    <main
      className={`console ${
        isMobile ? (showMobileContent ? 'console--mobile-content' : 'console--mobile-list') : ''
      }`}
    >
      {notifications.length > 0 && (
        <div className="notification-stack">
          {notifications.map((item) => (
            <button
              key={item.id}
              type="button"
              className="notification-card"
              onClick={() => handleSelectConversation(item.senderNumber)}
            >
              <div className="notification-card__title">
                {item.name || item.senderNumber}
              </div>
              <div className="notification-card__preview">{item.preview}</div>
              <div className="notification-card__time">{formatIsoTimestamp(item.timestamp)}</div>
            </button>
          ))}
        </div>
      )}

      {/* Booking Modal */}
      {selectedBooking && (
        <BookingModal 
          booking={selectedBooking} 
          onClose={() => setSelectedBooking(null)}
          onUpdate={async (id, status, notes) => {
            setIsUpdatingBooking(true);
            try {
              await updateBookingStatus(id, status, notes);
              await mutateBookings();
              setSelectedBooking(null);
            } finally {
              setIsUpdatingBooking(false);
            }
          }}
          isUpdating={isUpdatingBooking}
        />
      )}

      <aside className="sidebar">
        <div className="sidebar__header">
          <h1>Bosmat Admin Console</h1>
          <div className="view-switcher">
            <button 
              className={`view-btn ${viewMode === 'chat' ? 'active' : ''}`}
              onClick={() => setViewMode('chat')}
            >
              Chat
            </button>
            <button 
              className={`view-btn ${viewMode === 'calendar' ? 'active' : ''}`}
              onClick={() => setViewMode('calendar')}
            >
              Agenda
            </button>
          </div>
        </div>

        <label htmlFor="search" className="visually-hidden">
          Cari pelanggan
        </label>
        <input
          id="search"
          placeholder="Cari nama, nomor, atau pesan..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />

        {viewMode === 'chat' ? (
          <>
            {listError && <div className="notice">Gagal memuat daftar percakapan. {listError.message}</div>}
            <div className="conversation-list">
              {isLoadingList && !filteredConversations.length ? (
                <p className="muted">Memuat percakapan...</p>
              ) : filteredConversations.length ? (
                filteredConversations.map(renderConversationItem)
              ) : (
                <p className="muted">Belum ada percakapan yang tersimpan.</p>
              )}
            </div>
          </>
        ) : (
          <div className="sidebar__info">
            <p className="muted">Pilih tanggal di kalender untuk melihat detail booking.</p>
            <div className="legend">
              <div className="legend-item"><span className="dot pending"></span> Pending</div>
              <div className="legend-item"><span className="dot confirmed"></span> Confirmed</div>
              <div className="legend-item"><span className="dot in_progress"></span> In Progress</div>
              <div className="legend-item"><span className="dot completed"></span> Completed</div>
            </div>
          </div>
        )}
      </aside>

      <section className="content">
        {viewMode === 'calendar' ? (
          <CalendarView 
            currentDate={currentDate}
            onDateChange={setCurrentDate}
            bookings={bookingsData?.bookings || []}
            onSelectBooking={setSelectedBooking}
          />
        ) : activeConversation ? (
          <>
            <header className="content__header">
              <div className="content__header-info">
                <h2>{getConversationDisplayName(activeConversation)}</h2>
                <div className="content__header-meta">
                  <span className="muted" title={activeConversation.senderNumber}>
                    {activeConversation.platformId || activeConversation.senderNumber}
                  </span>
                  <span
                    className={`pill pill-channel ${activeChannelMeta.pillClass}`}
                    title={activeChannelMeta.label}
                  >
                    {activeChannelMeta.tag}
                  </span>
                </div>
                <div className="ai-status">
                  <span className={`pill ${aiPaused ? 'pill-warning' : 'pill-success'}`}>
                    {aiPaused ? 'AI OFF' : 'AI ON'}
                  </span>
                  <span className="muted ai-status__description">{aiStatusDescription}</span>
                </div>
              </div>
              <div
                className={`content__header-actions ${
                  isMobile ? 'content__header-actions--mobile' : ''
                }`}
              >
                {isMobile ? (
                  <>
                    <button
                      type="button"
                      className="toggle-button toggle-button--back"
                      onClick={() => setShowMobileContent(false)}
                    >
                      ← Daftar
                    </button>
                    <button
                      type="button"
                      className={mobileToggleClassName}
                      onClick={handleToggleAi}
                      disabled={!selectedNumber || isTogglingAi}
                    >
                      {mobileToggleLabel}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="badge">
                      {isLoadingHistory ? 'Memuat...' : `${historyData?.messageCount || 0} pesan`}
                    </span>
                    <button
                      type="button"
                      className={toggleButtonClassName}
                      onClick={handleToggleAi}
                      disabled={!selectedNumber || isTogglingAi}
                    >
                      {toggleButtonLabel}
                    </button>
                  </>
                )}
              </div>
            </header>

            <div className="chat-panel">
              {historyError && <div className="notice">Gagal memuat percakapan. {historyError.message}</div>}

              <div className="message-list">
                {historyData?.history?.length ? (
                  historyData.history.map((msg, index) => {
                    const timestampKey =
                      typeof msg.timestamp === 'object' && msg.timestamp
                        ? msg.timestamp.seconds
                        : msg.timestamp ?? 'ts';

                    return (
                      <div
                        key={`${timestampKey}-${index}`}
                        className={`message-item ${msg.sender}`}
                      >
                        <div className="message-item__meta">
                          <span className="message-item__sender">{getSenderLabel(msg.sender)}</span>
                          <span className="message-item__time">{formatTimestamp(msg.timestamp) || '—'}</span>
                        </div>
                        <div dangerouslySetInnerHTML={formatWhatsappText(msg.text)} />
                      </div>
                    );
                  })
                ) : (
                  <p className="muted">Belum ada pesan untuk percakapan ini.</p>
                )}
              </div>
            </div>

            <div className="composer">
              <textarea
                ref={messageInputRef}
                id="message"
                rows={1}
                aria-label="Balasan untuk pelanggan"
                placeholder="Tulis balasan untuk pelanggan..."
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <div className="composer__actions">
                {!canSendMessages && (
                  <span className="composer__hint">
                    Setel <code>NEXT_PUBLIC_API_BASE_URL</code> agar admin bisa membalas via backend bot.
                  </span>
                )}
                {canSendMessages && !isSupportedChannel && (
                  <span className="composer__hint">
                    Chat berasal dari kanal {activeChannelMeta.label}. Balasan admin UI untuk kanal ini belum didukung.
                  </span>
                )}
                {canSendMessages && isSupportedChannel && !isWhatsappConversation && (
                  <span className="composer__hint">
                    Balasan admin akan dikirim melalui {activeChannelMeta.label}.
                  </span>
                )}
                <button
                  type="button"
                  disabled={!selectedNumber || isSending || !canSendMessages || !isSupportedChannel}
                  onClick={handleSendMessage}
                >
                  {isSending ? 'Mengirim...' : 'Kirim'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>Pilih percakapan</h2>
            <p>Daftar percakapan yang tersimpan di Firestore akan muncul di sisi kiri.</p>
          </div>
        )}
      </section>
    </main>
  );
}

// --- Calendar Components & Helpers ---

async function updateBookingStatus(id: string, status: string, notes: string) {
  const url = buildApiUrl(`/bookings/${id}/status`);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
    body: JSON.stringify({ status, notes }),
  });
  if (!res.ok) throw new Error('Failed to update booking');
  return res.json();
}

function CalendarView({ 
  currentDate, 
  onDateChange, 
  bookings, 
  onSelectBooking 
}: { 
  currentDate: Date; 
  onDateChange: (d: Date) => void; 
  bookings: Booking[];
  onSelectBooking: (b: Booking) => void;
}) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sunday
  
  const days = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i));
  }

  const monthName = currentDate.toLocaleString('id-ID', { month: 'long', year: 'numeric' });

  const handlePrevMonth = () => onDateChange(new Date(year, month - 1, 1));
  const handleNextMonth = () => onDateChange(new Date(year, month + 1, 1));

  const getBookingsForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return bookings.filter(b => b.bookingDate === dateStr);
  };

  const getRepaintOccupancy = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    // Hitung booking repaint yang aktif pada tanggal ini
    const active = bookings.filter(b => {
      if (!b.isRepaint || b.status === 'cancelled' || b.status === 'completed') return false;
      return b.bookingDate <= dateStr && (b.estimatedEndDate || b.bookingDate) >= dateStr;
    });
    return active.length;
  };

  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <button onClick={handlePrevMonth}>&lt;</button>
        <h2>{monthName}</h2>
        <button onClick={handleNextMonth}>&gt;</button>
      </div>
      <div className="calendar-grid">
        {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map(d => (
          <div key={d} className="calendar-day-header">{d}</div>
        ))}
        {days.map((date, idx) => {
          if (!date) return <div key={idx} className="calendar-day empty"></div>;
          
          const dayBookings = getBookingsForDate(date);
          const isToday = new Date().toDateString() === date.toDateString();
          const repaintCount = getRepaintOccupancy(date);
          const isFull = repaintCount >= 2;

          return (
            <div key={idx} className={`calendar-day ${isToday ? 'today' : ''}`}>
              <div className="day-header">
                <span className="day-number">{date.getDate()}</span>
                {repaintCount > 0 && (
                  <span className={`capacity-badge ${isFull ? 'full' : 'partial'}`} title="Slot Repaint Terpakai">
                    🎨 {repaintCount}/2
                  </span>
                )}
              </div>
              <div className="day-events">
                {dayBookings.map(b => (
                  <button 
                    key={b.id} 
                    className={`event-pill status-${b.status}`}
                    onClick={() => onSelectBooking(b)}
                    title={`${b.customerName} - ${b.serviceName || 'Layanan'}`}
                  >
                    {b.bookingTime} {b.customerName.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <style jsx>{`
        .calendar-container { padding: 20px; height: 100%; display: flex; flex-direction: column; }
        .calendar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .calendar-header h2 { margin: 0; font-size: 1.5rem; }
        .calendar-header button { background: none; border: 1px solid #ddd; padding: 5px 15px; cursor: pointer; border-radius: 4px; }
        .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; flex: 1; }
        .calendar-day-header { text-align: center; font-weight: bold; color: #666; padding-bottom: 10px; }
        .calendar-day { border: 1px solid #eee; border-radius: 8px; padding: 8px; min-height: 100px; background: #fff; }
        .calendar-day.empty { background: transparent; border: none; }
        .calendar-day.today { border-color: #0070f3; background: #f0f7ff; }
        .day-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
        .day-number { font-weight: bold; font-size: 0.9rem; color: #333; }
        .capacity-badge { 
          font-size: 0.7rem; padding: 2px 6px; border-radius: 10px; font-weight: bold; color: white;
        }
        .capacity-badge.full { background-color: #e11d48; } /* Red */
        .capacity-badge.partial { background-color: #f59e0b; } /* Amber */
        
        .day-events { display: flex; flex-direction: column; gap: 4px; }
        .event-pill { 
          border: none; text-align: left; font-size: 0.75rem; padding: 4px 6px; 
          border-radius: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; 
          color: #fff; width: 100%;
        }
        .status-pending { background-color: #f5a623; }
        .status-confirmed { background-color: #108ee9; }
        .status-in_progress { background-color: #87d068; }
        .status-completed { background-color: #00a854; }
        .status-cancelled { background-color: #f50; }
      `}</style>
    </div>
  );
}

function BookingModal({ booking, onClose, onUpdate, isUpdating }: { 
  booking: Booking; 
  onClose: () => void; 
  onUpdate: (id: string, status: string, notes: string) => void;
  isUpdating: boolean;
}) {
  const [status, setStatus] = useState(booking.status);
  const [notes, setNotes] = useState(booking.adminNotes || '');

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Detail Booking</h3>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        <div className="modal-body">
          <div className="info-row">
            <label>Pelanggan:</label>
            <span>{booking.customerName} ({booking.customerPhone})</span>
          </div>
          <div className="info-row">
            <label>Waktu:</label>
            <span>{booking.bookingDate} jam {booking.bookingTime}</span>
          </div>
          <div className="info-row">
            <label>Layanan:</label>
            <span>{booking.services?.join(', ') || booking.serviceName}</span>
          </div>
          {booking.estimatedEndDate && (
            <div className="info-row">
              <label>Estimasi:</label>
              <span style={{ color: '#fbbf24' }}>
                {booking.estimatedDurationDays} hari (Selesai: {booking.estimatedEndDate})
              </span>
            </div>
          )}
          
          <hr />
          
          <div className="form-group">
            <label>Update Status:</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="form-group">
            <label>Catatan Admin:</label>
            <textarea 
              value={notes} 
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan progres pengerjaan..."
              rows={3}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} disabled={isUpdating}>Batal</button>
          <button 
            className="primary" 
            onClick={() => onUpdate(booking.id, status, notes)}
            disabled={isUpdating}
          >
            {isUpdating ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </div>
      <style jsx>{`
        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 1000;
        }
        .modal-content {
          background: #0f172a; color: #f8fafc; padding: 20px; border-radius: 8px; width: 90%; max-width: 500px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        .modal-header h3 { margin: 0; }
        .close-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #94a3b8; }
        .close-btn:hover { color: white; }
        .info-row { margin-bottom: 8px; display: flex; }
        .info-row label { font-weight: bold; width: 100px; color: #94a3b8; }
        .form-group { margin-top: 15px; }
        .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
        .form-group select, .form-group textarea {
          width: 100%; padding: 8px; border: 1px solid #334155; border-radius: 4px;
          background: #1e293b; color: white;
        }
        .modal-footer { margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; }
        .modal-footer button {
          padding: 8px 16px; border: 1px solid #334155; background: transparent; color: #e2e8f0; border-radius: 4px; cursor: pointer;
        }
        .modal-footer button.primary {
          background: #0070f3; color: white; border-color: #0070f3;
        }
        .modal-footer button:disabled { opacity: 0.7; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

/* Additional Global Styles for Sidebar Switcher */
/* Note: In a real Next.js app, these should be in globals.css or a module */
/* Adding style tag here for simplicity in single-file edit */
const _ = <style jsx global>{`
  :root {
    --bg-main: #0F172A;
    --bg-card: #1E293B;
    --border-color: #334155;
    --text-main: #F8FAFC;
    --text-muted: #94A3B8;
    --primary: #F4E603;
    --text-on-primary: #000000;
  }

  body { background-color: var(--bg-main); color: var(--text-main); }
  
  /* Layout Overrides */
  .console { background-color: var(--bg-main); }
  .sidebar { background-color: var(--bg-card); border-right: 1px solid var(--border-color); }
  .sidebar__header h1 { color: var(--text-main); }
  
  input#search {
    background-color: var(--bg-main);
    border: 1px solid var(--border-color);
    color: var(--text-main);
  }

  /* Conversation List */
  .conversation-item { border-bottom: 1px solid var(--border-color); color: var(--text-main); }
  .conversation-item:hover { background-color: rgba(255,255,255,0.05); }
  .conversation-item.active {
    background-color: rgba(244, 230, 3, 0.1);
    border-left: 4px solid var(--primary);
  }
  .conversation-item__name { color: var(--text-main); }
  .conversation-item__time, .conversation-item__subtitle { color: var(--text-muted); }

  /* Content Area */
  .content { background-color: var(--bg-main); }
  .content__header { border-bottom: 1px solid var(--border-color); background-color: var(--bg-card); }
  .content__header h2 { color: var(--text-main); }

  /* Chat Panel */
  .chat-panel { background-color: var(--bg-main); }
  .message-item { color: var(--text-main); }
  .message-item.user { background-color: var(--bg-card); border: 1px solid var(--border-color); }
  .message-item.ai {
    background-color: rgba(244, 230, 3, 0.1);
    border: 1px solid rgba(244, 230, 3, 0.3);
  }
  .message-item.admin {
    background-color: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.3);
  }
  .message-item__sender, .message-item__time { color: var(--text-muted); }

  /* Composer */
  .composer { border-top: 1px solid var(--border-color); background-color: var(--bg-card); }
  .composer textarea {
    background-color: var(--bg-main);
    border: 1px solid var(--border-color);
    color: var(--text-main);
  }
  .composer__actions button {
    background-color: var(--primary);
    color: var(--text-on-primary);
    border: none;
    font-weight: bold;
  }
  .composer__actions button:disabled {
    background-color: var(--border-color);
    color: var(--text-muted);
  }

  /* View Switcher */
  .view-switcher {
    display: flex; gap: 10px; margin-top: 10px;
  }
  .view-btn {
    flex: 1; padding: 6px; border: 1px solid var(--border-color); background: var(--bg-main);
    border-radius: 4px; cursor: pointer; font-size: 0.9rem; color: var(--text-muted);
  }
  .view-btn.active {
    background: var(--primary); color: var(--text-on-primary); border-color: var(--primary);
  }
  
  .sidebar__info { padding: 15px; border-top: 1px solid var(--border-color); margin-top: auto; color: var(--text-muted); }
  .legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
  .legend-item { display: flex; align-items: center; font-size: 0.8rem; color: var(--text-muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; display: inline-block; }
  .dot.pending { background: var(--primary); }
  .dot.confirmed { background: #108ee9; }
  .dot.in_progress { background: #87d068; }
  .dot.completed { background: #00a854; }

  /* Misc */
  .toggle-button {
    background-color: var(--bg-main);
    border: 1px solid var(--border-color);
    color: var(--text-main);
  }
  .badge { background-color: var(--border-color); color: var(--text-main); }
  
  /* Scrollbars */
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: var(--bg-main); }
  ::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #475569; }
`}</style>;

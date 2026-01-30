'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import useSWR from 'swr';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

const buildApiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  const isBrowser = typeof window !== 'undefined';
  const isSecureContext = isBrowser && window.location.protocol === 'https:';
  const isInsecureBase = API_BASE.startsWith('http://');

  const shouldUseRelativePath = !API_BASE || (isBrowser && isSecureContext && isInsecureBase);

  if (!shouldUseRelativePath && API_BASE) {
    return `${API_BASE}${normalizedPath}`;
  }

  return `/api${normalizedPath}`;
};

const fetcher = async (url: string) => {
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

export default function AdminConsole() {
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

      <aside className="sidebar">
        <div className="sidebar__header">
          <h1>Bosmat Admin Console</h1>
          <p>Kelola percakapan WhatsApp secara langsung.</p>
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
      </aside>

      <section className="content">
        {activeConversation ? (
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

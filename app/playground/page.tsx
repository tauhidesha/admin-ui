'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

const buildApiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (API_BASE) {
    if (!API_BASE.startsWith('http')) {
      return `https://${API_BASE}${normalizedPath}`;
    }
    return `${API_BASE}${normalizedPath}`;
  }
  return `/api${normalizedPath}`;
};

interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: Date;
  mode: 'customer' | 'admin';
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

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'customer' | 'admin'>('customer');
  const [senderNumber, setSenderNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash');

  // Mobile responsive states
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileContent, setShowMobileContent] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
    }
  }, [input]);

  // Screen size tracking
  useEffect(() => {
    const updateViewport = () => {
      const mobile = typeof window !== 'undefined' && window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) {
        setShowMobileContent(true);
      }
    };

    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: input.trim(),
      timestamp: new Date(),
      mode,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);
    setResponseTime(null);

    const startTime = Date.now();

    try {
      // Create the local history mapping to match Langchain format expectations (or at least simplify for backend)
      const mappedHistory = messages.map(msg => ({
        text: msg.text,
        sender: msg.role === 'ai' ? 'ai' : 'user'
      }));

      const res = await fetch(buildApiUrl('/test-ai'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({
          message: userMessage.text,
          senderNumber: senderNumber || undefined,
          mode,
          model_override: selectedModel,
          history: senderNumber ? undefined : mappedHistory, // Only send local history if no senderNumber (Firebase) is set
        }),
      });

      const elapsed = Date.now() - startTime;
      setResponseTime(elapsed);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server error (${res.status}): ${errText}`);
      }

      const data = await res.json();

      const aiMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'ai',
        text: data.ai_response || '(No response)',
        timestamp: new Date(),
        mode,
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
    setResponseTime(null);
  };

  return (
    <main className="console">
      {/* Sidebar - Settings and setup */}
      {(!isMobile || !showMobileContent) && (
        <aside className="sidebar">
          <div className="sidebar__header">
            <img
              src="/logo.png"
              alt="Bosmat Studio"
              className="sidebar__logo"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement?.querySelector('h1')?.style.setProperty('display', 'block');
              }}
            />
            <h1 style={{ display: 'none' }}>Bosmat Admin Console</h1>
            <div className="view-switcher" style={{ marginTop: '0.5rem' }}>
              <a href="/" className="view-btn" style={{ textAlign: 'center', textDecoration: 'none' }}>
                Chat
              </a>
              <a href="/?view=calendar" className="view-btn" style={{ textAlign: 'center', textDecoration: 'none' }}>
                Agenda
              </a>
              <button className="view-btn active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                🧪 Play
              </button>
            </div>
          </div>

          {/* Playground Controls as Sidebar info */}
          <div className="sidebar__info" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Testing Mode</label>
              <div className="view-switcher" style={{ background: 'var(--bg-deep)' }}>
                <button
                  className={`view-btn ${mode === 'customer' ? 'active' : ''}`}
                  onClick={() => setMode('customer')}
                >
                  👤 Customer
                </button>
                <button
                  className={`view-btn ${mode === 'admin' ? 'active' : ''}`}
                  onClick={() => setMode('admin')}
                >
                  👮 Admin
                </button>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                {mode === 'admin'
                  ? 'Mode Admin memicu internal tools.'
                  : 'Mode Customer simulasi chat biasa.'}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Sender Number</label>
              <input
                type="text"
                placeholder="opsional: e.g. 628..."
                value={senderNumber}
                onChange={(e) => setSenderNumber(e.target.value)}
                style={{ padding: '0.75rem', fontSize: '0.9rem' }}
              />
              {senderNumber ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>✅ Memory Firebase (Server) aktif</span>
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>ℹ️ Memory Lokal aktif</span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>AI Model</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{ padding: '0.75rem', fontSize: '0.9rem' }}
              >
                <option value="gemini-flash-lite-latest">Gemini Flash Lite (Latest)</option>
                <option value="gemini-flash-latest">Gemini Flash (Latest)</option>
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                <option value="gemini-3-flash-preview">Gemini 3 Flash (Preview)</option>
              </select>
            </div>

            {isMobile && (
              <button
                onClick={() => setShowMobileContent(true)}
                style={{
                  marginTop: '1rem',
                  background: 'var(--accent-yellow)',
                  border: '1px solid #d4d400',
                  color: '#000',
                  padding: '1rem',
                  borderRadius: '14px',
                  fontWeight: 700,
                  fontSize: '1.05rem',
                  cursor: 'pointer',
                  textAlign: 'center',
                  boxShadow: '0 4px 12px rgba(255, 234, 0, 0.4)'
                }}
              >
                Mulai Chat 🚀
              </button>
            )}

            <button
              onClick={clearChat}
              style={{
                marginTop: 'auto',
                background: 'transparent',
                border: '1px solid var(--border-highlight)',
                color: 'var(--text-muted)',
                padding: '0.75rem',
                borderRadius: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                transition: 'all 0.2s',
                boxShadow: 'none'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fef2f2'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-highlight)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              Clear History
            </button>
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      {(!isMobile || showMobileContent) && (
        <section className="content">
          {isMobile ? (
            <header className="content__header content__header--mobile">
              <button
                type="button"
                className="header-btn header-btn--back"
                onClick={() => setShowMobileContent(false)}
              >
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              </button>
              <div className="header-info">
                <h2>🧪 Zoya Playground</h2>
                <p className="status-text">{mode === 'admin' ? '👮 Mode Admin' : '👤 Mode Customer'}</p>
              </div>
            </header>
          ) : (
            <header className="content__header">
              <div className="content__header-info" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Zoya Playground</h2>
                <span className="pill pill-warning">Beta</span>
              </div>

              <div className="content__header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {responseTime !== null && (
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    ⚡ {responseTime}ms
                  </span>
                )}
                {error && (
                  <span className="pill" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca', fontSize: '0.8rem' }}>
                    ❌ {error}
                  </span>
                )}
              </div>
            </header>
          )}

          <div className="chat-panel" style={{ padding: 0, border: 'none', background: 'transparent' }}>
            <div className="message-list" style={{ padding: '0 1rem 1rem 0' }}>
              {messages.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6 }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem', filter: 'drop-shadow(0 0 10px rgba(255, 234, 0, 0.4))' }}>✨</div>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem', color: 'var(--text-main)' }}>Mulai Testing Zoya</h3>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)', textAlign: 'center', maxWidth: '300px' }}>
                    Ketik pesan untuk mensimulasikan percakapan. Sesuaikan pengaturan di sidebar sebelah kiri.
                  </p>
                </div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className={`message-item ${msg.role === 'ai' ? 'ai' : (mode === 'admin' ? 'admin' : 'user')}`}>
                    <div className="message-item__sender">
                      {msg.role === 'ai' ? 'Zoya (AI)' : (mode === 'admin' ? 'Admin' : 'Pelanggan')}
                    </div>
                    <div dangerouslySetInnerHTML={formatWhatsappText(msg.text)} />
                    <div className="message-item__time">
                      {msg.timestamp.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))
              )}

              {isLoading && (
                <div className="message-item ai" style={{ alignSelf: 'flex-start', border: '1px solid var(--border-dim)', background: 'var(--bg-surface)' }}>
                  <div className="message-item__sender">Zoya (AI)</div>
                  <div style={{ display: 'flex', gap: '4px', padding: '0.4rem 0' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--text-muted)', animation: 'ping 1.4s infinite 0s' }} />
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--text-muted)', animation: 'ping 1.4s infinite 0.2s' }} />
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--text-muted)', animation: 'ping 1.4s infinite 0.4s' }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="composer-wrapper" style={{ padding: '1rem 0 0', background: 'var(--bg-surface)' }}>
              <div className="composer">
                <textarea
                  ref={textareaRef}
                  placeholder={mode === 'admin' ? 'Ketik sebagai Admin...' : 'Tanyakan sesuatu ke Zoya...'}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                  rows={1}
                  style={{ flex: 1, minHeight: '52px', borderRadius: '24px', padding: '1rem 1.25rem' }}
                />
                <button
                  className="send-btn"
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  style={{
                    opacity: (!input.trim() || isLoading) ? 0.4 : 1,
                    cursor: (!input.trim() || isLoading) ? 'not-allowed' : 'pointer',
                    background: 'var(--accent-yellow)',
                    border: '1px solid #d4d400',
                    color: '#000'
                  }}
                >
                  {isLoading ? (
                    <div style={{ width: '18px', height: '18px', border: '2px solid rgba(0,0,0,0.1)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <style jsx global>{`
        @keyframes ping {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </main>
  );
}

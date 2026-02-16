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
  toolCalls?: string[];
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
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);

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
    <div className="pg-wrapper">
      <div className="pg-container">
        {/* Header */}
        <div className="pg-header">
          <div className="pg-header__left">
            <a href="/" className="pg-back-btn" title="Kembali ke Admin Console">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </a>
            <div className="pg-header__title">
              <h1>🧪 Zoya Playground</h1>
              <p className="pg-header__subtitle">Test AI responses tanpa WhatsApp</p>
            </div>
          </div>
          <div className="pg-header__actions">
            <button
              className={`pg-nav-btn ${showSettings ? 'active' : ''}`}
              onClick={() => setShowSettings(!showSettings)}
              title="Settings"
            >
              ⚙️
            </button>
            <button className="pg-nav-btn pg-nav-btn--danger" onClick={clearChat} title="Clear Chat">
              🗑️
            </button>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="pg-settings">
            <div className="pg-settings__card">
              <div className="pg-settings__row">
                <label className="pg-settings__label">Testing Mode</label>
                <div className="pg-mode-toggle">
                  <button
                    className={`pg-mode-btn ${mode === 'customer' ? 'active' : ''}`}
                    onClick={() => setMode('customer')}
                  >
                    👤 Customer
                  </button>
                  <button
                    className={`pg-mode-btn ${mode === 'admin' ? 'active' : ''}`}
                    onClick={() => setMode('admin')}
                  >
                    👮 Admin
                  </button>
                </div>
              </div>
              <div className="pg-settings__row">
                <label className="pg-settings__label">Sender Number (Opsional)</label>
                <input
                  type="text"
                  className="pg-sender-input"
                  placeholder="628xxxxxxxxxx (untuk test memory)"
                  value={senderNumber}
                  onChange={(e) => setSenderNumber(e.target.value)}
                />
              </div>
              <div className="pg-settings__hint">
                {mode === 'admin'
                  ? '👮 Mode Admin: Menggunakan prompt internal admin.'
                  : '👤 Mode Customer: Simulasi chat pelanggan biasa.'}
                {senderNumber && ` • Memory aktif untuk ${senderNumber}`}
              </div>
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className="pg-chat-area">
          {messages.length === 0 ? (
            <div className="pg-empty">
              <div className="pg-empty__icon">✨</div>
              <h2>Zoya Playground</h2>
              <p>Tanyakan apapun untuk mulai testing logika Zoya.</p>
              <div className="pg-empty__tips">
                <div className="pg-tip">💡 <strong>Shift+Enter</strong> untuk baris baru</div>
                <div className="pg-tip">⚙️ Klik <strong>Settings</strong> untuk test memory</div>
                <div className="pg-tip">🤖 Gunakan mode Admin untuk akses tools internal</div>
              </div>
            </div>
          ) : (
            <div className="pg-messages">
              {messages.map((msg) => (
                <div key={msg.id} className={`pg-msg ${msg.role}`}>
                  <div className="pg-msg__sender">
                    {msg.role === 'ai' ? 'Zoya (AI)' : (mode === 'admin' ? 'Admin' : 'Pelanggan')}
                  </div>
                  <div className="pg-msg__bubble">
                    <div
                      className="pg-msg__text"
                      dangerouslySetInnerHTML={formatWhatsappText(msg.text)}
                    />
                    <div className="pg-msg__meta">
                      <span className="pg-msg__time">
                        {msg.timestamp.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="pg-msg ai typing">
                  <div className="pg-msg__sender">Zoya (AI)</div>
                  <div className="pg-msg__bubble">
                    <div className="pg-typing-dots">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Status & Response Time */}
        {(error || responseTime !== null) && (
          <div className={`pg-status ${error ? 'error' : 'success'}`}>
            {error ? (
              <span className="pg-status__error">❌ {error}</span>
            ) : (
              <span className="pg-status__time">⚡ Latency: <strong>{responseTime}ms</strong></span>
            )}
          </div>
        )}

        {/* Composer */}
        <div className="pg-composer">
          <div className="pg-composer__inner">
            <textarea
              ref={textareaRef}
              className="pg-input"
              placeholder={mode === 'admin' ? 'Ketik sebagai Admin...' : 'Tanyakan sesuatu ke Zoya...'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              rows={1}
            />
            <button
              className="pg-send-btn"
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
            >
              {isLoading ? (
                <div className="pg-spinner"></div>
              ) : (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .pg-wrapper {
          min-height: 100vh;
          background: #f4f4f5; /*Zinc-100 matching main UI bg*/
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }

        .pg-container {
          width: 100%;
          max-width: 900px;
          height: 85vh;
          display: flex;
          flex-direction: column;
          background: #ffffff;
          border-radius: 24px;
          border: 1px solid #e4e4e7;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); /* Premium shadow */
          overflow: hidden;
          position: relative;
        }
        
        /* Header */
        .pg-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.25rem 2rem;
          background: #18181b; /* Zinc-950 sleek dark */
          color: white;
          flex-shrink: 0;
          z-index: 10;
        }
        
        .pg-header__left {
          display: flex;
          align-items: center;
          gap: 1.25rem;
        }
        
        .pg-back-btn {
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.1);
          transition: all 0.2s;
        }
        .pg-back-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          transform: translateX(-2px);
        }
        
        .pg-header__title h1 {
          margin: 0;
          font-size: 1.15rem;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        
        .pg-header__subtitle {
          margin: 0;
          font-size: 0.75rem;
          opacity: 0.6;
          font-weight: 400;
        }
        
        .pg-header__actions {
          display: flex;
          gap: 0.75rem;
        }
        
        .pg-nav-btn {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          width: 38px;
          height: 38px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.2s;
        }
        .pg-nav-btn:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .pg-nav-btn.active {
          background: #FFEA00;
          color: #000;
          border-color: #FFEA00;
        }
        .pg-nav-btn--danger:hover {
          background: #ef4444;
          border-color: #ef4444;
        }
        
        /* Settings */
        .pg-settings {
          padding: 1.5rem 2rem;
          background: #fafafa;
          border-bottom: 1px solid #e4e4e7;
          flex-shrink: 0;
          animation: slideDown 0.3s ease-out;
        }
        @keyframes slideDown {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        
        .pg-settings__card {
           display: flex;
           flex-direction: column;
           gap: 1rem;
        }

        .pg-settings__row {
          display: flex;
          align-items: center;
          gap: 2rem;
        }
        
        .pg-settings__label {
          font-size: 0.85rem;
          font-weight: 600;
          color: #52525b; /* Zinc-600 */
          min-width: 180px;
        }
        
        .pg-mode-toggle {
          display: flex;
          gap: 0.4rem;
          background: #f4f4f5;
          padding: 4px;
          border-radius: 12px;
        }
        
        .pg-mode-btn {
          padding: 0.5rem 1.25rem;
          border-radius: 9px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          background: transparent;
          border: none;
          color: #71717a;
          transition: all 0.2s;
        }
        .pg-mode-btn.active {
          background: white;
          color: #18181b;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }
        
        .pg-sender-input {
          flex: 1;
          padding: 0.6rem 1rem;
          border-radius: 12px;
          border: 1px solid #e4e4e7;
          font-size: 0.9rem;
          background: white;
        }
        .pg-sender-input:focus {
           outline: none;
           border-color: #FFEA00;
           box-shadow: 0 0 0 3px rgba(255, 234, 0, 0.2);
        }
        
        .pg-settings__hint {
          font-size: 0.78rem;
          color: #a1a1aa;
          font-style: italic;
        }
        
        /* Chat Area */
        .pg-chat-area {
          flex: 1;
          overflow-y: auto;
          background: #ffffff;
          display: flex;
          flex-direction: column;
        }
        
        /* Empty State */
        .pg-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
          padding: 3rem;
          color: #71717a;
        }
        .pg-empty__icon {
          font-size: 3.5rem;
          margin-bottom: 1.5rem;
          filter: drop-shadow(0 0 10px rgba(255, 234, 0, 0.4));
        }
        .pg-empty h2 {
          margin: 0 0 0.75rem;
          color: #18181b;
          font-size: 1.75rem;
          font-weight: 800;
          letter-spacing: -0.02em;
        }
        .pg-empty p {
          margin: 0 0 2.5rem;
          font-size: 1rem;
          opacity: 0.8;
          max-width: 400px;
        }
        .pg-empty__tips {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          max-width: 450px;
        }
        .pg-tip {
          font-size: 0.85rem;
          padding: 0.75rem 1.25rem;
          background: #f8fafc;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          color: #475569;
        }
        
        /* Messages */
        .pg-messages {
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        
        .pg-msg {
          display: flex;
          flex-direction: column;
          max-width: 80%;
          gap: 0.4rem;
        }
        .pg-msg.user {
          align-self: flex-end;
          align-items: flex-end;
        }
        .pg-msg.ai {
          align-self: flex-start;
          align-items: flex-start;
        }
        
        .pg-msg__sender {
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #a1a1aa;
        }

        .pg-msg__bubble {
          padding: 1rem 1.25rem;
          border-radius: 18px;
          font-size: 0.95rem;
          line-height: 1.6;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
          word-break: break-word;
          position: relative;
        }
        
        .pg-msg.user .pg-msg__bubble {
          background: #FFEA00;
          color: #000;
          border-bottom-right-radius: 4px;
          font-weight: 500;
          border: 1px solid #d4d400;
        }
        
        .pg-msg.ai .pg-msg__bubble {
          background: #f4f4f5;
          color: #18181b;
          border-bottom-left-radius: 4px;
          border: 1px solid #e4e4e7;
        }
        
        .pg-msg__text {
          margin: 0;
        }
        
        .pg-msg__meta {
          display: flex;
          justify-content: flex-end;
          margin-top: 0.4rem;
        }
        .pg-msg__time {
          font-size: 0.68rem;
          opacity: 0.5;
        }
        
        /* Typing Indicator */
        .pg-msg.typing .pg-msg__bubble {
          padding: 0.85rem 1.25rem;
        }
        .pg-typing-dots {
          display: flex;
          gap: 5px;
          align-items: center;
        }
        .pg-typing-dots span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #a1a1aa;
          animation: pgBounce 1.4s ease-in-out infinite;
        }
        .pg-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .pg-typing-dots span:nth-child(3) { animation-delay: 0.4s; }
        
        @keyframes pgBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        
        /* Status */
        .pg-status {
          position: absolute;
          bottom: 100px;
          left: 50%;
          transform: translateX(-50%);
          padding: 0.5rem 1.25rem;
          border-radius: 99px;
          font-size: 0.75rem;
          z-index: 5;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .pg-status.success {
          background: #18181b;
          color: #FFEA00;
        }
        .pg-status.error {
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }
        
        /* Composer */
        .pg-composer {
          padding: 1.5rem 2rem;
          background: white;
          border-top: 1px solid #e4e4e7;
          flex-shrink: 0;
        }
        
        .pg-composer__inner {
          display: flex;
          align-items: flex-end;
          gap: 1rem;
          background: #f4f4f5;
          padding: 0.5rem 0.5rem 0.5rem 1.25rem;
          border-radius: 20px;
          border: 1px solid #e4e4e7;
          transition: all 0.2s;
        }
        .pg-composer__inner:focus-within {
          background: white;
          border-color: #FFEA00;
          box-shadow: 0 0 0 3px rgba(255, 234, 0, 0.2);
        }
        
        .pg-input {
          flex: 1;
          padding: 0.75rem 0 !important;
          border: none !important;
          background: transparent !important;
          font-size: 1rem !important;
          resize: none;
          max-height: 150px;
          line-height: 1.5;
          font-family: inherit;
          color: #18181b;
        }
        .pg-input:focus {
          outline: none;
        }
        
        .pg-send-btn {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: #FFEA00;
          border: 1px solid #d4d400;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #000;
          flex-shrink: 0;
          transition: all 0.2s;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        .pg-send-btn:hover:not(:disabled) {
          transform: scale(1.05);
          background: #facc15;
        }
        .pg-send-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          filter: grayscale(1);
        }

        .pg-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(0,0,0,0.1);
          border-top-color: #000;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        @media (max-width: 768px) {
          .pg-wrapper {
            padding: 0;
          }
          .pg-container {
            height: 100vh;
            border-radius: 0;
            max-width: 100%;
            border: none;
          }
          .pg-header {
            padding: 1rem;
          }
          .pg-settings {
            padding: 1rem;
          }
          .pg-settings__row {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.5rem;
          }
          .pg-settings__label {
            min-width: unset;
          }
          .pg-composer {
            padding: 1rem;
          }
          .pg-messages {
            padding: 1rem;
          }
          .pg-msg {
            max-width: 90%;
          }
        }
      `}</style>
    </div>
  );
}

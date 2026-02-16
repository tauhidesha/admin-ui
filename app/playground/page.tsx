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
        <>
            <div className="pg-container">
                {/* Header */}
                <div className="pg-header">
                    <div className="pg-header__left">
                        <a href="/" className="pg-back-btn" title="Kembali ke Admin Console">
                            ←
                        </a>
                        <div className="pg-header__title">
                            <h1>🧪 Zoya Playground</h1>
                            <p className="pg-header__subtitle">Test AI responses tanpa WhatsApp</p>
                        </div>
                    </div>
                    <div className="pg-header__actions">
                        <button
                            className="pg-settings-toggle"
                            onClick={() => setShowSettings(!showSettings)}
                            title="Settings"
                        >
                            ⚙️
                        </button>
                        <button className="pg-clear-btn" onClick={clearChat} title="Clear Chat">
                            🗑️ Clear
                        </button>
                    </div>
                </div>

                {/* Settings Panel */}
                {showSettings && (
                    <div className="pg-settings">
                        <div className="pg-settings__row">
                            <label className="pg-settings__label">Mode</label>
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
                            <label className="pg-settings__label">Sender Number (opsional)</label>
                            <input
                                type="text"
                                className="pg-sender-input"
                                placeholder="628xxxxxxxxxx (kosongkan = tanpa memory)"
                                value={senderNumber}
                                onChange={(e) => setSenderNumber(e.target.value)}
                            />
                        </div>
                        <div className="pg-settings__hint">
                            {mode === 'admin'
                                ? '👮 Admin Mode: Zoya akan pakai ADMIN_SYSTEM_PROMPT'
                                : '👤 Customer Mode: Zoya akan pakai SYSTEM_PROMPT biasa'}
                            {senderNumber && ` • Memory aktif untuk ${senderNumber}`}
                        </div>
                    </div>
                )}

                {/* Chat Area */}
                <div className="pg-chat-area">
                    {messages.length === 0 ? (
                        <div className="pg-empty">
                            <div className="pg-empty__icon">🧪</div>
                            <h2>Zoya Playground</h2>
                            <p>Ketik pesan untuk mulai testing Zoya AI.</p>
                            <div className="pg-empty__tips">
                                <div className="pg-tip">💡 Shift+Enter untuk baris baru</div>
                                <div className="pg-tip">⚙️ Klik gear untuk ubah mode (Customer/Admin)</div>
                                <div className="pg-tip">📱 Isi sender number untuk test memory/history</div>
                            </div>
                        </div>
                    ) : (
                        <div className="pg-messages">
                            {messages.map((msg) => (
                                <div key={msg.id} className={`pg-msg ${msg.role}`}>
                                    <div className="pg-msg__bubble">
                                        <div
                                            className="pg-msg__text"
                                            dangerouslySetInnerHTML={formatWhatsappText(msg.text)}
                                        />
                                        <div className="pg-msg__meta">
                                            <span className="pg-msg__time">
                                                {msg.timestamp.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            {msg.role === 'user' && (
                                                <span className={`pg-msg__mode ${msg.mode}`}>
                                                    {msg.mode === 'admin' ? '👮' : '👤'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div className="pg-msg ai">
                                    <div className="pg-msg__bubble pg-msg__typing">
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

                {/* Status Bar */}
                {(error || responseTime !== null) && (
                    <div className={`pg-status ${error ? 'error' : 'success'}`}>
                        {error ? `❌ ${error}` : `⚡ Response time: ${responseTime}ms`}
                    </div>
                )}

                {/* Composer */}
                <div className="pg-composer">
                    <textarea
                        ref={textareaRef}
                        className="pg-input"
                        placeholder={mode === 'admin' ? 'Chat sebagai Admin...' : 'Chat sebagai Customer...'}
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
                        {isLoading ? '⏳' : '🚀'}
                    </button>
                </div>
            </div>

            <style jsx>{`
        .pg-container {
          height: 100vh;
          display: flex;
          flex-direction: column;
          max-width: 900px;
          margin: 0 auto;
          background: var(--bg-surface);
          box-shadow: 0 0 40px rgba(0,0,0,0.08);
        }
        
        .pg-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.5rem;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          color: white;
          flex-shrink: 0;
        }
        
        .pg-header__left {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        
        .pg-back-btn {
          color: white;
          text-decoration: none;
          font-size: 1.2rem;
          padding: 0.3rem 0.6rem;
          border-radius: 8px;
          background: rgba(255,255,255,0.1);
          transition: background 0.2s;
        }
        .pg-back-btn:hover {
          background: rgba(255,255,255,0.2);
        }
        
        .pg-header__title h1 {
          margin: 0;
          font-size: 1.2rem;
          font-weight: 700;
        }
        
        .pg-header__subtitle {
          margin: 0;
          font-size: 0.78rem;
          opacity: 0.7;
        }
        
        .pg-header__actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }
        
        .pg-settings-toggle,
        .pg-clear-btn {
          background: rgba(255,255,255,0.1) !important;
          border: 1px solid rgba(255,255,255,0.2) !important;
          color: white !important;
          padding: 0.5rem 0.8rem !important;
          border-radius: 10px !important;
          cursor: pointer;
          font-size: 0.85rem;
          box-shadow: none !important;
        }
        .pg-settings-toggle:hover,
        .pg-clear-btn:hover {
          background: rgba(255,255,255,0.2) !important;
          transform: none !important;
        }
        
        /* Settings */
        .pg-settings {
          background: #f8f9fb;
          padding: 1rem 1.5rem;
          border-bottom: 1px solid var(--border-dim);
          flex-shrink: 0;
        }
        
        .pg-settings__row {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.6rem;
        }
        
        .pg-settings__label {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-muted);
          min-width: 180px;
        }
        
        .pg-mode-toggle {
          display: flex;
          gap: 0.3rem;
          background: var(--bg-deep);
          padding: 3px;
          border-radius: 10px;
        }
        
        .pg-mode-btn {
          padding: 0.4rem 1rem !important;
          border-radius: 8px !important;
          font-size: 0.85rem !important;
          font-weight: 600;
          cursor: pointer;
          background: transparent !important;
          border: none !important;
          color: var(--text-muted) !important;
          box-shadow: none !important;
        }
        .pg-mode-btn:hover {
          transform: none !important;
          box-shadow: none !important;
        }
        .pg-mode-btn.active {
          background: var(--bg-surface) !important;
          color: var(--text-main) !important;
          box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        }
        
        .pg-sender-input {
          flex: 1;
          padding: 0.5rem 0.8rem !important;
          border-radius: 10px !important;
          font-size: 0.85rem !important;
        }
        
        .pg-settings__hint {
          font-size: 0.78rem;
          color: var(--text-dim);
          padding: 0.3rem 0;
        }
        
        /* Chat Area */
        .pg-chat-area {
          flex: 1;
          overflow-y: auto;
          background: var(--bg-wa-light);
          background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4c9a0' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
        }
        
        /* Empty State */
        .pg-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
          padding: 2rem;
          color: var(--text-muted);
        }
        .pg-empty__icon {
          font-size: 4rem;
          margin-bottom: 1rem;
        }
        .pg-empty h2 {
          margin: 0 0 0.5rem;
          color: var(--text-main);
          font-size: 1.5rem;
        }
        .pg-empty p {
          margin: 0 0 2rem;
          font-size: 0.95rem;
        }
        .pg-empty__tips {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .pg-tip {
          font-size: 0.82rem;
          padding: 0.5rem 1rem;
          background: rgba(255,255,255,0.7);
          border-radius: 12px;
          border: 1px solid var(--border-dim);
        }
        
        /* Messages */
        .pg-messages {
          padding: 1rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        
        .pg-msg {
          display: flex;
          max-width: 80%;
        }
        .pg-msg.user {
          align-self: flex-end;
          margin-left: auto;
        }
        .pg-msg.ai {
          align-self: flex-start;
        }
        
        .pg-msg__bubble {
          padding: 0.6rem 0.9rem;
          border-radius: 12px;
          font-size: 0.93rem;
          line-height: 1.55;
          box-shadow: 0 1px 2px rgba(0,0,0,0.08);
          word-break: break-word;
        }
        
        .pg-msg.user .pg-msg__bubble {
          background: var(--accent-yellow);
          color: #000;
          border-bottom-right-radius: 4px;
          border: 1px solid #d4d400;
        }
        
        .pg-msg.ai .pg-msg__bubble {
          background: #ffffff;
          color: var(--text-main);
          border-bottom-left-radius: 4px;
          border: 1px solid var(--border-dim);
        }
        
        .pg-msg__text {
          margin: 0;
        }
        
        .pg-msg__meta {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 0.4rem;
          margin-top: 0.25rem;
        }
        .pg-msg__time {
          font-size: 0.68rem;
          color: var(--text-dim);
        }
        .pg-msg__mode {
          font-size: 0.68rem;
        }
        
        /* Typing Indicator */
        .pg-msg__typing {
          padding: 0.8rem 1.2rem;
        }
        .pg-typing-dots {
          display: flex;
          gap: 4px;
          align-items: center;
        }
        .pg-typing-dots span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-dim);
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
          padding: 0.4rem 1.5rem;
          font-size: 0.78rem;
          flex-shrink: 0;
        }
        .pg-status.success {
          background: #f0fdf4;
          color: #166534;
          border-top: 1px solid #bbf7d0;
        }
        .pg-status.error {
          background: #fef2f2;
          color: #991b1b;
          border-top: 1px solid #fecaca;
        }
        
        /* Composer */
        .pg-composer {
          display: flex;
          align-items: flex-end;
          gap: 0.75rem;
          padding: 0.75rem 1.5rem;
          background: #f0f2f5;
          border-top: 1px solid var(--border-dim);
          flex-shrink: 0;
        }
        
        .pg-input {
          flex: 1;
          padding: 0.7rem 1rem !important;
          border-radius: 20px !important;
          border: none !important;
          background: #ffffff !important;
          font-size: 0.95rem !important;
          resize: none;
          max-height: 150px;
          line-height: 1.4;
          font-family: inherit;
        }
        .pg-input:focus {
          outline: none;
          box-shadow: 0 0 0 2px var(--accent-yellow-glow) !important;
        }
        
        .pg-send-btn {
          width: 46px;
          height: 46px;
          border-radius: 50% !important;
          background: var(--accent-yellow) !important;
          border: 1px solid #d4d400 !important;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 1.2rem;
          padding: 0 !important;
          flex-shrink: 0;
          box-shadow: 0 2px 6px rgba(0,0,0,0.1) !important;
        }
        .pg-send-btn:hover:not(:disabled) {
          transform: scale(1.05) !important;
        }
        .pg-send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none !important;
        }
        
        @media (max-width: 768px) {
          .pg-container {
            max-width: 100%;
          }
          .pg-msg {
            max-width: 88%;
          }
          .pg-settings__row {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.4rem;
          }
          .pg-settings__label {
            min-width: unset;
          }
          .pg-sender-input {
            width: 100%;
          }
        }
      `}</style>
        </>
    );
}

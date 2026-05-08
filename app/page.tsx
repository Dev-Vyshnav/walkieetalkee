'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function Home() {
  const [roomId, setRoomId] = useState('');

  useEffect(() => {
    // Generate a random room ID on the client to avoid hydration mismatch
    const randomStr = Math.random().toString(36).substring(2, 8);
    setRoomId(`room-${randomStr}`);
  }, []);

  return (
    <div className="home-container">
      <main className="hero-content">
        {/* Logo/Branding */}
        <div className="branding">
          <div className="logo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" className="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h1 className="main-title text-glow">Web-Talkie</h1>
          <p className="subtitle">Lightweight, zero-friction voice communication.</p>
        </div>

        {/* Feature Cards */}
        <div className="features-grid">
          <div className="feature-card">
            <span className="feature-title">🚀 Zero-Friction Access</span>
            <p className="feature-desc">No login required. Join via link and start talking.</p>
          </div>
          <div className="feature-card">
            <span className="feature-title">⚡ Real-time Performance</span>
            <p className="feature-desc">Sub-500ms latency for a true walkie-talkie experience.</p>
          </div>
        </div>

        {/* Action Area */}
        <div className="action-area">
          {roomId ? (
            <Link
              href={`/room/${roomId}`}
              className="big-primary-button"
              id="create-room-btn"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              Create Room
            </Link>
          ) : (
            <button
              className="big-primary-button"
              disabled
              id="create-room-btn"
            >
              Generating Room...
            </button>
          )}
        </div>

        {/* Footer/Disclaimer */}
        <p className="disclaimer">
          By creating a room, you agree to grant microphone access when prompted.
        </p>
      </main>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

export default function PWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setIsInstalled(true);
    }

    const handler = (e: any) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('User accepted the PWA install');
    } else {
      console.log('User dismissed the PWA install');
    }

    // We've used the prompt, and can't use it again, so clear it
    setDeferredPrompt(null);
  };

  // Don't show if already installed or if prompt isn't available
  if (isInstalled || !deferredPrompt) {
    return null;
  }

  return (
    <div className="install-prompt-container">
      <button 
        onClick={handleInstallClick}
        className="install-button"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="install-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Install Web-Talkie
      </button>
      <style jsx>{`
        .install-prompt-container {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          animation: slideUp 0.5s ease-out;
        }
        .install-button {
          background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
          color: white;
          padding: 12px 24px;
          border-radius: 9999px;
          border: none;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 10px 25px -5px rgba(249, 115, 22, 0.4);
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .install-button:hover {
          transform: scale(1.05);
          box-shadow: 0 20px 30px -10px rgba(249, 115, 22, 0.5);
        }
        .install-icon {
          width: 20px;
          height: 20px;
        }
        @keyframes slideUp {
          from { transform: translate(-50%, 100px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

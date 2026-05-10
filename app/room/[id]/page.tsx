'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';

export default function RoomPage() {
  const params = useParams();
  const roomId = params.id as string;

  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
  const [usersInRoom, setUsersInRoom] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [showHelp, setShowHelp] = useState(false);

  const socketRef = useRef<Socket | null>(null);


  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<any>(null);
  const pttButtonRef = useRef<HTMLButtonElement>(null);

  // iOS Safari touch handling
  useEffect(() => {
    const btn = pttButtonRef.current;
    if (!btn) return;

    const preventSelection = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault(); // Prevent multi-touch zoom
    };

    btn.addEventListener('touchstart', preventSelection, { passive: false });
    
    return () => {
      btn.removeEventListener('touchstart', preventSelection);
    };
  }, []);

  // Track Microphone Permission
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.permissions && (navigator.permissions as any).query) {
      const checkPermission = async () => {
        try {
          const status = await navigator.permissions.query({ name: 'microphone' as any });
          setMicPermission(status.state as any);
          status.onchange = () => {
            setMicPermission(status.state as any);
          };
        } catch (err) {
          console.log('Permissions API not supported for microphone');
        }
      };
      checkPermission();
    }
  }, []);

  // Wake Lock to keep screen on

  useEffect(() => {
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        try {
          // Check if we already have a lock
          if (wakeLockRef.current) return;
          
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          console.log('Wake Lock active');
          
          wakeLockRef.current.addEventListener('release', () => {
            console.log('Wake Lock released');
            wakeLockRef.current = null;
          });
        } catch (err) {
          // Silence visibility errors
          if ((err as any).name !== 'NotAllowedError') {
            console.error('Wake Lock error:', err);
          }
        }
      }
    };

    const handleVisibilityChange = () => {
      if (isConnected && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    if (isConnected) {
      requestWakeLock();
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().then(() => {
          wakeLockRef.current = null;
        });
      }
    };
  }, [isConnected]);


  // Haptic feedback
  const vibrate = (pattern: number | number[]) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  };

  // Synthesize a static "click" when PTT starts
  const playStartClick = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    const bufferSize = ctx.sampleRate * 0.05; // 50ms
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1; // White noise
    }
    
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 2000;
    
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    noise.start();
  }, []);

  // Synthesize a "roger beep" when PTT ends
  const playRogerBeep = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
    gainNode.gain.setValueAtTime(0.15, ctx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0, ctx.currentTime + 0.15);
    
    osc.frequency.setValueAtTime(1000, ctx.currentTime);
    osc.frequency.setValueAtTime(1500, ctx.currentTime + 0.05); // Switch tone halfway
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }, []);

  const handleCopyLink = async () => {
    const url = window.location.href;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for non-secure contexts
        const textArea = document.createElement("textarea");
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  useEffect(() => {
    // Initialize socket connection
    const signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';
    socketRef.current = io(signalingUrl, {
      transports: ['websocket']
    });

    socketRef.current.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to signaling server');

      // Request mic access and join room after connection
      initAudioAndJoin();
    });

    socketRef.current.on('disconnect', () => {
      setIsConnected(false);
      console.log('Disconnected from signaling server');
    });

    socketRef.current.on('room-full', () => {
      setError('Room is full (max 8 users).');
    });

    socketRef.current.on('current-users', (users: string[]) => {
      setUsersInRoom(users);
      // Create offers to existing users
      users.forEach(userId => {
        createPeerConnection(userId, true);
      });
    });

    socketRef.current.on('user-joined', ({ userId }: { userId: string }) => {
      setUsersInRoom(prev => [...prev, userId]);
    });

    socketRef.current.on('offer', async (data: { sdp: RTCSessionDescriptionInit, sender: string }) => {
      console.log(`Received offer from ${data.sender}`);
      const pc = createPeerConnection(data.sender, false);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit('answer', { sdp: answer, roomId, to: data.sender });
    });

    socketRef.current.on('answer', async (data: { sdp: RTCSessionDescriptionInit, sender: string }) => {
      console.log(`Received answer from ${data.sender}`);
      const pc = peersRef.current[data.sender];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    });

    socketRef.current.on('ice-candidate', (data: { candidate: RTCIceCandidateInit, sender: string }) => {
      console.log(`Received ICE candidate from ${data.sender}`);
      const pc = peersRef.current[data.sender];
      if (pc) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });

    socketRef.current.on('ptt-state', (data: { isSpeaking: boolean, sender: string }) => {
      console.log(`PTT state from ${data.sender}: ${data.isSpeaking}`);
      if (data.isSpeaking) {
        setActiveSpeakers(prev => [...prev, data.sender]);
        playStartClick();
      } else {
        setActiveSpeakers(prev => prev.filter(id => id !== data.sender));
        playRogerBeep();
      }
    });

    socketRef.current.on('user-left', ({ userId }: { userId: string }) => {
      setUsersInRoom(prev => prev.filter(id => id !== userId));
      setActiveSpeakers(prev => prev.filter(id => id !== userId));
      cleanupPeer(userId);
    });

    return () => {
      // Cleanup
      socketRef.current?.disconnect();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      Object.keys(peersRef.current).forEach(cleanupPeer);
    };
  }, [roomId, playStartClick, playRogerBeep]);

  const initAudioAndJoin = async () => {
    try {
      if (!audioCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AudioContextClass();
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }

      // We no longer request the mic here to keep the red dot hidden.
      // We only join the room.
      console.log('Joining room...');
      socketRef.current?.emit('join-room', roomId);
    } catch (err) {
      console.error('Error initializing audio:', err);
      setError('Audio initialization failed.');
    }
  };


  const createPeerConnection = (userId: string, isInitiator: boolean) => {
    if (peersRef.current[userId]) return peersRef.current[userId];

    const pc = new RTCPeerConnection(iceServers);
    peersRef.current[userId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.ontrack = (event) => {
      console.log(`Received remote track from ${userId}`);
      const remoteStream = event.streams[0];

      let audioEl = document.getElementById(`audio-${userId}`) as HTMLAudioElement;
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `audio-${userId}`;
        audioEl.autoplay = true;
        audioEl.muted = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = remoteStream;

      if (audioCtxRef.current && !(audioEl as any)._audioProcessed) {
        (audioEl as any)._audioProcessed = true;
        const audioCtx = audioCtxRef.current;
        
        try {
          const source = audioCtx.createMediaStreamSource(remoteStream);
          const highpass = audioCtx.createBiquadFilter();
          highpass.type = 'highpass';
          highpass.frequency.value = 300;
          const lowpass = audioCtx.createBiquadFilter();
          lowpass.type = 'lowpass';
          lowpass.frequency.value = 3000;
          const distortion = audioCtx.createWaveShaper();
          const k = 50;
          const n_samples = 44100;
          const curve = new Float32Array(n_samples);
          const deg = Math.PI / 180;
          for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
          }
          distortion.curve = curve;
          const gainNode = audioCtx.createGain();
          gainNode.gain.value = 1.2;

          source.connect(highpass);
          highpass.connect(lowpass);
          lowpass.connect(distortion);
          distortion.connect(gainNode);
          gainNode.connect(audioCtx.destination);
        } catch (err) {
          console.error('Error applying radio filters:', err);
          audioEl.muted = false;
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('ice-candidate', {
          candidate: event.candidate,
          roomId,
          to: userId
        });
      }
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socketRef.current?.emit('offer', { sdp: offer, roomId, to: userId });
        } catch (err) {
          console.error('Error creating offer:', err);
        }
      };
    }

    return pc;
  };

  const cleanupPeer = (userId: string) => {
    if (peersRef.current[userId]) {
      peersRef.current[userId].close();
      delete peersRef.current[userId];
    }
    const audioEl = document.getElementById(`audio-${userId}`);
    if (audioEl) {
      audioEl.remove();
    }
  };

  const handlePTTStart = async () => {
    setIsSpeaking(true);
    playStartClick();
    vibrate(40);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      localStreamRef.current = stream;
      const audioTrack = stream.getAudioTracks()[0];

      // Update all existing peer connections
      Object.values(peersRef.current).forEach(pc => {
        const senders = pc.getSenders();
        const audioSender = senders.find(s => s.track?.kind === 'audio' || !s.track);
        
        if (audioSender) {
          audioSender.replaceTrack(audioTrack);
        } else {
          pc.addTrack(audioTrack, stream);
        }
      });

      socketRef.current?.emit('ptt-state', { isSpeaking: true, roomId });
    } catch (err) {
      console.error('Failed to get microphone:', err);
      setIsSpeaking(false);
    }
  };

  const handlePTTEnd = () => {
    setIsSpeaking(false);
    playRogerBeep();
    vibrate([20, 50, 20]);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      
      // Clear tracks from peer connections to ensure red dot disappears
      Object.values(peersRef.current).forEach(pc => {
        pc.getSenders().forEach(sender => {
          if (sender.track?.kind === 'audio') {
            sender.replaceTrack(null);
          }
        });
      });
      
      localStreamRef.current = null;
    }

    socketRef.current?.emit('ptt-state', { isSpeaking: false, roomId });
  };

  const requestMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately stop it, we just wanted the permission
      stream.getTracks().forEach(t => t.stop());
      setMicPermission('granted');
    } catch (err) {
      console.error('Permission request failed:', err);
      setMicPermission('denied');
    }
  };



  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isSpeaking) {
        e.preventDefault();
        handlePTTStart();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handlePTTEnd();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSpeaking]);

  return (
    <div className="room-container">
      <header className="room-header">
        <div className="status-indicator">
          <span className={`dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
          <span>{isConnected ? 'Connected' : 'Connecting...'}</span>
          <span className="separator">|</span>
          <span className={`mic-status ${micPermission}`}>
            Mic: {micPermission === 'granted' ? 'Allowed' : micPermission === 'denied' ? 'Blocked' : 'Ready'}
          </span>
        </div>
        <h2 className="room-title">Frequency: {roomId}</h2>
        <button 
          className={`copy-link-btn ${copied ? 'copied' : ''}`} 
          onClick={handleCopyLink}
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <main className="room-content">
        <div className="ptt-area">
          <button
            ref={pttButtonRef}
            className={`ptt-button ${isSpeaking ? 'active' : ''}`}
            onMouseDown={handlePTTStart}
            onMouseUp={handlePTTEnd}
            onMouseLeave={handlePTTEnd}
            onTouchStart={(e) => { e.preventDefault(); handlePTTStart(); }}
            onTouchEnd={(e) => { e.preventDefault(); handlePTTEnd(); }}
            onContextMenu={(e) => e.preventDefault()}
            disabled={!isConnected || !!error || micPermission === 'denied'}
          >
            <div className="inner-circle">
              <span>
                {micPermission === 'denied' ? 'MIC BLOCKED' : isSpeaking ? 'TALKING' : 'HOLD TO TALK'}
              </span>
            </div>
          </button>
          
          {/* Permission Guidance Button */}
          {micPermission !== 'granted' && (
            <div className="perm-container">
              <button 
                className={`perm-guide-btn ${micPermission}`}
                onClick={micPermission === 'prompt' ? requestMicPermission : () => setShowHelp(!showHelp)}
              >
                {micPermission === 'prompt' ? 'Click to Enable Microphone' : 'How to unblock microphone?'}
              </button>
              
              {showHelp && micPermission === 'denied' && (
                <div className="help-box">
                  <h4>To unblock your mic:</h4>
                  <ul>
                    <li>Click the <strong>Lock Icon</strong> 🔒 next to the URL above.</li>
                    <li>Toggle <strong>Microphone</strong> to <strong>"On"</strong>.</li>
                    <li>Refresh this page.</li>
                  </ul>
                  <p className="mobile-hint">On mobile, tap the <strong>AA</strong> or <strong>Settings</strong> icon in the address bar.</p>
                </div>
              )}
            </div>
          )}

          
          <p className="ptt-hint">Or press and hold Spacebar</p>
        </div>


        <div className="participants-area">
          <h3>Users Online ({usersInRoom.length + 1})</h3>
          <div className="users-list">
            <div className={`user-item self ${isSpeaking ? 'speaking' : ''}`}>
              <span className="user-name">You</span>
              {isSpeaking && <span className="speaking-indicator">⚡</span>}
            </div>
            {usersInRoom.map(userId => (
              <div key={userId} className={`user-item ${activeSpeakers.includes(userId) ? 'speaking' : ''}`}>
                <span className="user-name">{userId.substring(0, 6)}...</span>
                {activeSpeakers.includes(userId) && <span className="speaking-indicator">🔊</span>}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

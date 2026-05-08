'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';

export default function RoomPage() {
  const params = useParams();
  const roomId = params.id as string;

  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
  const [usersInRoom, setUsersInRoom] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});

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
      // Wait for offer from new user (or we can create one)
      // Standard approach: new user creates offers to existing users.
      // So here we just wait for the offer.
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
        // Audio ducking simulation: lower volume of others if needed
      } else {
        setActiveSpeakers(prev => prev.filter(id => id !== data.sender));
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
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      Object.keys(peersRef.current).forEach(cleanupPeer);
    };
  }, [roomId]);

  const initAudioAndJoin = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      // By default, mute the local stream until PTT is pressed
      stream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });

      console.log('Microphone access granted');
      socketRef.current?.emit('join-room', roomId);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Microphone access is required for Web-Talkie.');
    }
  };

  const createPeerConnection = (userId: string, isInitiator: boolean) => {
    if (peersRef.current[userId]) return peersRef.current[userId];

    const pc = new RTCPeerConnection(iceServers);
    peersRef.current[userId] = pc;

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Handle remote stream
    pc.ontrack = (event) => {
      console.log(`Received remote track from ${userId}`);
      const remoteStream = event.streams[0];

      // Create or update audio element for this user
      let audioEl = document.getElementById(`audio-${userId}`) as HTMLAudioElement;
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `audio-${userId}`;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = remoteStream;
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('ice-candidate', {
          candidate: event.candidate,
          roomId,
          to: userId
        });
      }
    };

    // If initiator, create offer
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

  const handlePTTStart = () => {
    if (!localStreamRef.current) return;
    setIsSpeaking(true);

    // Enable microphone track
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = true;
    });

    socketRef.current?.emit('ptt-state', { isSpeaking: true, roomId });
  };

  const handlePTTEnd = () => {
    if (!localStreamRef.current) return;
    setIsSpeaking(false);

    // Disable microphone track
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = false;
    });

    socketRef.current?.emit('ptt-state', { isSpeaking: false, roomId });
  };

  // Keyboard support for Spacebar
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
        </div>
        <h2 className="room-title">Frequency: {roomId}</h2>
        <button className="copy-link-btn" onClick={() => navigator.clipboard.writeText(window.location.href)}>
          Copy Link
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <main className="room-content">
        {/* Big PTT Button */}
        <div className="ptt-area">
          <button
            className={`ptt-button ${isSpeaking ? 'active' : ''}`}
            onMouseDown={handlePTTStart}
            onMouseUp={handlePTTEnd}
            onMouseLeave={handlePTTEnd}
            onTouchStart={handlePTTStart}
            onTouchEnd={handlePTTEnd}
            disabled={!isConnected || !!error}
          >
            <div className="inner-circle">
              <span>{isSpeaking ? 'TALKING' : 'HOLD TO TALK'}</span>
            </div>
          </button>
          <p className="ptt-hint">Or press and hold Spacebar</p>
        </div>

        {/* Participants List */}
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

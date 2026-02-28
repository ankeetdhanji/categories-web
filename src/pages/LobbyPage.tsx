import { useEffect, useState } from 'react';
import { useGame, type Player } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api } from '../services/api';
import { startConnection, joinGameGroup, leaveGameGroup, HubEvents } from '../services/signalr';

const REACTIONS = ['🔥', '👏', '😂', '🎉', '💀'];

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
}

export default function LobbyPage() {
  const { gameId, joinCode, playerId, isHost, players, setPlayers, addPlayer, removePlayer, setPhase } = useGame();
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [floaters, setFloaters] = useState<FloatingReaction[]>([]);
  const [nextId, setNextId] = useState(0);

  // Connect to SignalR and join game group
  useEffect(() => {
    if (!gameId) return;
    startConnection()
      .then(() => joinGameGroup(gameId))
      .catch(console.error);
    return () => {
      leaveGameGroup(gameId).catch(console.error);
    };
  }, [gameId]);

  // Load initial player list (refreshes state if navigating back)
  useEffect(() => {
    if (!gameId) return;
    api.getGame(gameId).then((game) => {
      setPlayers(
        game.players.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          isHost: p.id === game.hostPlayerId,
          isGuest: p.isGuest,
          totalScore: p.totalScore,
        }))
      );
    });
  }, [gameId]);

  useSignalREvent(HubEvents.PlayerJoined, (player) => {
    addPlayer(player as Player);
  });

  useSignalREvent(HubEvents.PlayerLeft, (data) => {
    removePlayer((data as { playerId: string }).playerId);
  });

  useSignalREvent(HubEvents.GameCountdown, () => {
    setPhase('countdown');
  });

  useSignalREvent(HubEvents.EmojiReaction, (data) => {
    spawnFloater((data as { emoji: string }).emoji);
  });

  function spawnFloater(emoji: string) {
    const id = nextId;
    setNextId((n) => n + 1);
    const x = 10 + Math.random() * 80;
    setFloaters((f) => [...f, { id, emoji, x }]);
    setTimeout(() => setFloaters((f) => f.filter((r) => r.id !== id)), 2000);
  }

  async function handleCopy() {
    if (!joinCode) return;
    await navigator.clipboard.writeText(joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleStart() {
    if (!gameId || !playerId) return;
    setStarting(true);
    try {
      await api.startGame(gameId, playerId);
    } finally {
      setStarting(false);
    }
  }

  async function handleReaction(emoji: string) {
    spawnFloater(emoji);
    // TODO: broadcast via SignalR invoke when hub method is available
  }

  function initials(name: string) {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  function avatarColor(id: string) {
    const colors = [
      'bg-blue-600', 'bg-purple-600', 'bg-emerald-600',
      'bg-rose-600', 'bg-amber-600', 'bg-cyan-600',
    ];
    const hash = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return colors[hash % colors.length];
  }

  return (
    <div className="relative flex flex-col items-center min-h-screen bg-[var(--color-bg)] overflow-hidden">
      {/* Floating reactions */}
      {floaters.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none fixed bottom-24 text-4xl animate-bounce z-50"
          style={{ left: `${r.x}%`, animation: 'floatUp 2s ease-out forwards' }}
        >
          {r.emoji}
        </span>
      ))}

      <div className="w-full max-w-md px-6 py-10 flex flex-col gap-6">
        {/* Header */}
        <div className="text-center">
          <p className="text-[var(--color-text-muted)] text-sm uppercase tracking-widest mb-1">Game Code</p>
          <button
            onClick={handleCopy}
            className="group inline-flex items-center gap-3 cursor-pointer"
            title="Copy code"
          >
            <span className="text-5xl font-mono font-black tracking-widest text-[var(--color-text)]">
              {joinCode}
            </span>
            <span className="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] transition-colors text-sm">
              {copied ? '✓ Copied' : 'Copy'}
            </span>
          </button>
        </div>

        {/* Players list */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
              Players
            </span>
            <span className="text-sm text-[var(--color-text-muted)]">{players.length}</span>
          </div>

          <ul className="divide-y divide-[var(--color-border)]">
            {players.length === 0 && (
              <li className="px-4 py-6 text-center text-[var(--color-text-muted)] text-sm">
                Waiting for players to join…
              </li>
            )}
            {players.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 px-4 py-3 animate-[fadeIn_0.3s_ease]"
              >
                {/* Avatar */}
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${avatarColor(p.id)}`}
                >
                  {initials(p.displayName)}
                </div>

                {/* Name */}
                <span className="flex-1 text-[var(--color-text)] font-medium truncate">
                  {p.displayName}
                  {p.id === playerId && (
                    <span className="ml-2 text-xs text-[var(--color-text-subtle)]">(you)</span>
                  )}
                </span>

                {/* Badges */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {p.isHost && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--color-primary)] text-white">
                      Host
                    </span>
                  )}
                  {p.isGuest && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-border)] text-[var(--color-text-muted)]">
                      Guest
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Reactions */}
        <div className="flex justify-center gap-2">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => handleReaction(emoji)}
              className="w-10 h-10 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-xl hover:scale-110 active:scale-95 transition-transform"
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Start button (host only) */}
        {isHost && (
          <button
            onClick={handleStart}
            disabled={starting || players.length < 1}
            className="w-full py-3.5 rounded-xl font-bold text-white bg-[var(--color-primary)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_20px_var(--color-primary-glow)]"
          >
            {starting ? 'Starting…' : 'Start Game'}
          </button>
        )}

        {!isHost && (
          <p className="text-center text-sm text-[var(--color-text-muted)]">
            Waiting for the host to start…
          </p>
        )}
      </div>

      <style>{`
        @keyframes floatUp {
          0%   { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-200px) scale(1.4); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

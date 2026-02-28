import { useEffect, useState } from 'react';
import { useGame, type Player } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api } from '../services/api';
import { startConnection, joinGameGroup, leaveGameGroup, sendReaction, HubEvents } from '../services/signalr';

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
  const [showReactions, setShowReactions] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    startConnection()
      .then(() => joinGameGroup(gameId))
      .catch(console.error);
    return () => { leaveGameGroup(gameId).catch(console.error); };
  }, [gameId]);

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

  useSignalREvent(HubEvents.PlayerJoined, (player) => { addPlayer(player as Player); });
  useSignalREvent(HubEvents.PlayerLeft, (data) => { removePlayer((data as { playerId: string }).playerId); });
  useSignalREvent(HubEvents.GameCountdown, () => { setPhase('countdown'); });
  useSignalREvent(HubEvents.EmojiReaction, (data) => { spawnFloater((data as { emoji: string }).emoji); });

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
    if (gameId) sendReaction(gameId, emoji).catch(console.error);
    setShowReactions(false);
  }

  function initials(name: string) {
    return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  }

  const AVATAR_COLORS = ['#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];

  function avatarColor(id: string) {
    const hash = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  return (
    <div className="relative min-h-screen bg-[#0b0f14] overflow-hidden">
      {/* Background glows */}
      <div className="pointer-events-none fixed -top-24 -left-24 w-[600px] h-[600px] rounded-full blur-[120px]" style={{ background: '#3b82f6', opacity: 0.08 }} />
      <div className="pointer-events-none fixed bottom-0 right-0 w-[600px] h-[600px] rounded-full blur-[120px]" style={{ background: '#ec4899', opacity: 0.05 }} />

      {/* Floating reaction emojis */}
      {floaters.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none fixed bottom-24 text-4xl z-50"
          style={{ left: `${r.x}%`, animation: 'floatUp 2s ease-out forwards' }}
        >
          {r.emoji}
        </span>
      ))}

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[#263244] bg-[rgba(11,15,20,0.8)] backdrop-blur-md">
        <div className="h-16 px-6 grid grid-cols-3 items-center">
          {/* Left: branding */}
          <div className="flex items-center gap-2.5">
            <div className="relative w-8 h-8 rounded-[10px] bg-[#161f2b] border border-[#263244] flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-[#3b82f6] to-[#ec4899] opacity-20" />
              <span className="relative font-bold text-[#e5e7eb] text-sm">C</span>
            </div>
            <span className="font-bold text-[#e5e7eb] text-lg tracking-tight">Categories</span>
          </div>

          {/* Center: room code */}
          <div className="flex flex-col items-center gap-0.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280]">Room Code</p>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 bg-[#161f2b] border border-[#263244] rounded-full px-4 py-1 hover:border-[#3b82f6] transition-colors"
            >
              <span className="font-mono font-bold text-[#e5e7eb] text-lg tracking-[1.8px]">{joinCode}</span>
              <CopyIcon />
            </button>
            <p className="text-[10px] text-[#6b7280]">
              {copied ? '✓ Copied!' : 'Share this code with friends'}
            </p>
          </div>

          {/* Right: player count */}
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-1.5 bg-[#161f2b] border border-[#263244] rounded-full px-3 py-1.5">
              <UsersIcon />
              <span className="text-sm font-medium text-[#9ca3af]">{players.length}/10</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="px-6 py-6 max-w-3xl mx-auto flex flex-col gap-6 pb-32">
        {/* Players card */}
        <div className="bg-[#111827] border border-[#263244] rounded-2xl shadow-[0px_20px_25px_0px_rgba(0,0,0,0.1),0px_8px_10px_0px_rgba(0,0,0,0.1)] overflow-hidden">
          <div className="px-6 py-5 flex items-center justify-between">
            <h2 className="font-bold text-[#e5e7eb] text-lg tracking-tight">Players</h2>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#10b981]" />
              <span className="text-xs font-medium text-[#9ca3af]">Live</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 px-6 pb-4">
            {players.length === 0 && (
              <p className="text-center text-sm text-[#6b7280] py-6">Waiting for players to join…</p>
            )}
            {players.map((p) => (
              <div
                key={p.id}
                className="bg-[#161f2b] border border-[rgba(38,50,68,0.5)] rounded-[14px] flex items-center gap-4 px-4 py-3"
                style={{ animation: 'fadeIn 0.3s ease' }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-[#0b0f14] text-sm font-bold flex-shrink-0 shadow-sm"
                  style={{ background: avatarColor(p.id) }}
                >
                  {initials(p.displayName)}
                </div>

                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#e5e7eb] text-base truncate">{p.displayName}</span>
                    {p.isHost && (
                      <span className="flex items-center gap-1 bg-[rgba(236,72,153,0.1)] border border-[rgba(236,72,153,0.2)] rounded px-1.5 py-0.5 flex-shrink-0">
                        <CrownIcon />
                        <span className="text-[10px] font-bold uppercase tracking-wide text-[#ec4899]">Host</span>
                      </span>
                    )}
                    {p.id === playerId && !p.isHost && (
                      <span className="text-xs text-[#6b7280] flex-shrink-0">(you)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] flex-shrink-0" />
                    <span className="text-xs text-[#9ca3af]">Connected</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-[#263244] px-6 py-3 flex items-center justify-center gap-2">
            <PlusIcon />
            <span className="text-sm text-[#9ca3af]">Send the room code to invite friends</span>
          </div>
        </div>

        {/* Scoring summary card */}
        <div className="bg-[rgba(22,31,43,0.5)] border border-[rgba(38,50,68,0.5)] rounded-[10px] px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#9ca3af]">Unique answer</span>
            <span className="font-mono text-xs text-[#e5e7eb]">10 pts</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#9ca3af]">Shared answer</span>
            <span className="font-mono text-xs text-[#e5e7eb]">5 pts</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#9ca3af]">Best answer</span>
            <span className="font-mono text-xs text-[#e5e7eb]">20 pts</span>
          </div>
          <div className="border-t border-[#263244] pt-2 flex items-center justify-between">
            <span className="text-xs text-[#9ca3af]">Voting</span>
            <span className="text-xs text-[#e5e7eb]">30s · Tie = Valid</span>
          </div>
        </div>
      </main>

      {/* Floating reaction button */}
      <div className="fixed bottom-8 right-6 z-50 flex flex-col items-end gap-2">
        {showReactions && (
          <div className="flex flex-col gap-1 bg-[#161f2b] border border-[#263244] rounded-2xl p-2 shadow-lg" style={{ animation: 'fadeIn 0.15s ease' }}>
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleReaction(emoji)}
                className="w-10 h-10 rounded-full flex items-center justify-center text-xl hover:bg-[#263244] transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setShowReactions((v) => !v)}
          className="w-12 h-12 rounded-full bg-[#161f2b] border border-[#263244] flex items-center justify-center shadow-[0px_10px_15px_0px_rgba(0,0,0,0.1),0px_4px_6px_0px_rgba(0,0,0,0.1)] hover:border-[#3b82f6] transition-colors"
        >
          <SmileIcon />
        </button>
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-6 pb-6 pt-4 bg-gradient-to-t from-[#0b0f14] to-transparent">
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          {isHost ? (
            <button
              onClick={handleStart}
              disabled={starting || players.length < 1}
              className="w-full h-14 rounded-[14px] font-bold text-lg text-[#0b0f14] bg-[#3b82f6] flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0px_0px_20px_0px_rgba(59,130,246,0.3)]"
            >
              {starting ? 'Starting…' : (
                <>
                  <span>Start Game</span>
                  <PlayIcon />
                </>
              )}
            </button>
          ) : (
            <div className="w-full h-14 rounded-[14px] bg-[#111827] border border-[#263244] flex items-center justify-center">
              <span className="text-sm text-[#6b7280]">Waiting for the host to start…</span>
            </div>
          )}
          <p className="text-center text-xs text-[#6b7280]">
            {isHost ? 'Game starts with a 5-second countdown' : ''}
          </p>
        </div>
      </div>

      <style>{`
        @keyframes floatUp {
          0%   { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-200px) scale(1.4); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="#ec4899">
      <path d="M2 20h20M5 20L3 8l5 4 4-8 4 8 5-4-2 12H5z" stroke="#ec4899" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#0b0f14">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );
}

function SmileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

import { useState } from 'react';
import { api } from '../services/api';
import { useGame } from '../context/GameContext';

export default function HomePage() {
  const { setGameId, setJoinCode, setPlayer, setHost, setPhase, setPlayers, setFullSettings } = useGame();
  const [joinCode, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setJoinError('Please enter a game code.');
      return;
    }
    setJoinError('');
    setIsJoining(true);
    try {
      const playerId = crypto.randomUUID();
      const res = await api.joinGame(code, playerId, 'Guest');
      setPlayer(playerId, 'Guest');
      setGameId(res.gameId);
      setJoinCode(code);
      setHost(false);
      setPlayers(res.players.map((p) => ({ ...p, isHost: false })));
      setFullSettings(res.settings);
      setPhase('lobby');
    } catch {
      setJoinError('Game not found. Check the code and try again.');
    } finally {
      setIsJoining(false);
    }
  }

  async function handleCreate() {
    setIsCreating(true);
    setCreateError('');
    try {
      const playerId = crypto.randomUUID();
      const res = await api.createGame(playerId, 'Host');
      setPlayer(playerId, 'Host');
      setGameId(res.gameId);
      setJoinCode(res.joinCode);
      setHost(true);
      setPlayers([{ id: playerId, displayName: 'Host', isHost: true, isGuest: false, totalScore: 0 }]);
      setFullSettings(res.settings);
      setPhase('lobby');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create game. Is the server running?');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden px-4 py-12">
      {/* Background glow blobs */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
        style={{ width: 600, height: 600, background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-10 blur-3xl"
        style={{ width: 400, height: 400, background: 'radial-gradient(circle, #ec4899 0%, transparent 70%)' }}
      />

      <div className="relative z-10 flex flex-col items-center gap-10 w-full max-w-[420px]">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="relative">
              <div
                className="relative flex items-center justify-center rounded-[14px] overflow-hidden"
                style={{
                  width: 48, height: 48,
                  background: '#111827',
                  border: '1px solid #263244',
                  boxShadow: '0px 10px 15px -3px rgba(0,0,0,0.1)',
                }}
              >
                <div className="absolute inset-0 top-0 left-0 right-0 h-1/2" style={{ background: 'rgba(255,255,255,0.05)' }} />
                <span className="relative font-extrabold text-white text-2xl tracking-tighter select-none">C</span>
              </div>
              {/* Glow bar under logo */}
              <div
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full opacity-70 blur-sm"
                style={{ width: 40, height: 6, background: 'linear-gradient(to right, #3b82f6, #ec4899)' }}
              />
              {/* Decorative dots */}
              <div className="absolute -top-0.5 -right-0.5 rounded-full opacity-60" style={{ width: 10, height: 10, background: '#ec4899' }} />
              <div className="absolute -bottom-0.5 right-[-10px] rounded-full opacity-60" style={{ width: 7, height: 7, background: '#3b82f6' }} />
            </div>

            {/* Wordmark */}
            <div className="flex flex-col gap-1">
              <span
                className="font-bold text-2xl tracking-tight leading-none select-none"
                style={{ color: '#e5e7eb', letterSpacing: '-0.6px' }}
              >
                Categories
              </span>
              <div
                className="rounded-full h-[3px]"
                style={{ background: 'linear-gradient(to right, #3b82f6, #ec4899)' }}
              />
            </div>
          </div>
          <p className="text-base font-medium" style={{ color: '#9ca3af' }}>
            A real-time categories game
          </p>
        </div>

        {/* Card */}
        <div
          className="w-full rounded-2xl px-6 py-6 flex flex-col gap-0"
          style={{
            background: '#111827',
            border: '1px solid #263244',
            boxShadow: '0px 25px 50px 0px rgba(0,0,0,0.25)',
          }}
        >
          {/* Join section */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium uppercase tracking-widest" style={{ color: '#9ca3af', paddingLeft: 4 }}>
              Game Code
            </label>
            <input
              value={joinCode}
              onChange={(e) => { setJoinCodeInput(e.target.value.toUpperCase()); setJoinError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="e.g. K7P4"
              maxLength={8}
              className="w-full rounded-[10px] px-4 text-lg font-mono tracking-wide outline-none focus:ring-2"
              style={{
                height: 48,
                background: '#161f2b',
                border: '1px solid #263244',
                color: '#e5e7eb',
                letterSpacing: '0.05em',
              }}
            />
            {joinError ? (
              <p className="text-xs pl-1" style={{ color: '#f87171' }}>{joinError}</p>
            ) : (
              <p className="text-xs pl-1" style={{ color: '#9ca3af' }}>Enter a code from your host</p>
            )}

            <button
              onClick={handleJoin}
              disabled={isJoining}
              className="w-full rounded-[10px] flex items-center justify-center gap-2 font-bold text-base transition-opacity disabled:opacity-60"
              style={{
                height: 48,
                background: '#3b82f6',
                color: '#0b0f14',
                boxShadow: '0px 0px 15px 0px rgba(59,130,246,0.3)',
                marginTop: 8,
              }}
            >
              {isJoining ? (
                <Spinner />
              ) : (
                <>
                  <span>Join Lobby</span>
                  <ArrowRightIcon />
                </>
              )}
            </button>
          </div>

          {/* Divider */}
          <div className="relative flex items-center my-6">
            <div className="flex-1 border-t" style={{ borderColor: '#263244' }} />
            <span
              className="absolute left-1/2 -translate-x-1/2 px-3 text-xs font-medium"
              style={{ background: '#111827', color: '#6b7280' }}
            >
              OR
            </span>
          </div>

          {/* Create section */}
          <div className="flex flex-col gap-4">
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="w-full rounded-[10px] flex items-center justify-center gap-2 font-medium text-base transition-colors disabled:opacity-60 hover:bg-white/5"
              style={{
                height: 48,
                border: '1px solid #263244',
                color: '#e5e7eb',
              }}
            >
              {isCreating ? <Spinner /> : (
                <>
                  <PlusIcon />
                  <span>Create Game</span>
                </>
              )}
            </button>

            {createError && (
              <p className="text-center text-xs" style={{ color: '#f87171' }}>{createError}</p>
            )}
            <p className="text-center text-xs" style={{ color: '#6b7280' }}>
              Play as guest or sign in later
            </p>
          </div>
        </div>

        {/* Footer badges */}
        <div className="flex items-center gap-2 text-xs font-medium" style={{ color: '#6b7280' }}>
          <UsersIcon />
          <span>Private rooms only</span>
          <div className="rounded-full" style={{ width: 4, height: 4, background: '#6b7280' }} />
          <span>No matchmaking</span>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 14v-1.5A2.5 2.5 0 008.5 10h-5A2.5 2.5 0 001 12.5V14M15 14v-1.5a2.5 2.5 0 00-2-2.45M11 2.13a2.5 2.5 0 010 4.74M6 7a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

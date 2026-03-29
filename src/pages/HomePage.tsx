import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { api } from '../services/api';
import { useGame } from '../context/GameContext';
import { STATUS_TO_PHASE } from '../App';

interface ActiveGame {
  gameId: string;
  joinCode: string;
  playerId: string;
  displayName: string;
  createdAt?: number;
}

export default function HomePage() {
  const { setGameId, setJoinCode, setPlayer, setHost, setPhase, setPlayers, setFullSettings, setCurrentRound } = useGame();
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('displayName') ?? '');
  const [nameError, setNameError] = useState('');
  const [joinCode, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [activeGame, setActiveGame] = useState<ActiveGame | null>(null);
  const [checkingActiveGame, setCheckingActiveGame] = useState(true);
  const [isRejoining, setIsRejoining] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('active_game');
    if (!stored) {
      setCheckingActiveGame(false);
      return;
    }
    let parsed: ActiveGame;
    try {
      parsed = JSON.parse(stored) as ActiveGame;
    } catch {
      localStorage.removeItem('active_game');
      setCheckingActiveGame(false);
      return;
    }
    // Discard entries older than 48 hours without making an API call
    const fortyEightHours = 48 * 60 * 60 * 1000;
    if (parsed.createdAt && Date.now() - parsed.createdAt > fortyEightHours) {
      localStorage.removeItem('active_game');
      setCheckingActiveGame(false);
      return;
    }
    api.getGame(parsed.gameId)
      .then((game) => {
        const stillActive = game.status < 7;
        const stillInGame = game.players.some((p) => p.id === parsed.playerId);
        if (stillActive && stillInGame) {
          setActiveGame(parsed);
        } else {
          localStorage.removeItem('active_game');
        }
      })
      .catch(() => {
        // Network error — keep the entry so the rejoin card stays visible
        setActiveGame(parsed);
      })
      .finally(() => {
        setCheckingActiveGame(false);
      });
  }, []);

  function getValidatedName(): string | null {
    const name = displayName.trim();
    if (!name) { setNameError('Please enter your name.'); return null; }
    if (name.length > 20) { setNameError('Name must be 20 characters or fewer.'); return null; }
    return name;
  }

  async function handleJoin() {
    const name = getValidatedName();
    if (!name) return;
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setJoinError('Please enter a game code.');
      return;
    }
    setJoinError('');
    setIsJoining(true);
    try {
      const playerId = crypto.randomUUID();
      const res = await api.joinGame(code, playerId, name);
      localStorage.setItem('displayName', name);
      localStorage.setItem('active_game', JSON.stringify({ gameId: res.gameId, joinCode: code, playerId, displayName: name, createdAt: Date.now() }));
      setPlayer(playerId, name);
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
    const name = getValidatedName();
    if (!name) return;
    setIsCreating(true);
    setCreateError('');
    try {
      const playerId = crypto.randomUUID();
      const res = await api.createGame(playerId, name);
      localStorage.setItem('displayName', name);
      localStorage.setItem('active_game', JSON.stringify({ gameId: res.gameId, joinCode: res.joinCode, playerId, displayName: name, createdAt: Date.now() }));
      setPlayer(playerId, name);
      setGameId(res.gameId);
      setJoinCode(res.joinCode);
      setHost(true);
      setPlayers([{ id: playerId, displayName: name, isHost: true, isGuest: false, totalScore: 0 }]);
      setFullSettings(res.settings);
      setPhase('lobby');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create game. Is the server running?');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRejoin() {
    if (!activeGame) return;
    setIsRejoining(true);
    try {
      const game = await api.getGame(activeGame.gameId);
      const stillActive = game.status < 7;
      const stillInGame = game.players.some((p) => p.id === activeGame.playerId);
      if (!stillActive || !stillInGame) {
        localStorage.removeItem('active_game');
        setActiveGame(null);
        return;
      }
      setPlayer(activeGame.playerId, activeGame.displayName);
      setGameId(activeGame.gameId);
      setJoinCode(activeGame.joinCode);
      setHost(game.hostPlayerId === activeGame.playerId);
      setPlayers(
        game.players.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          isHost: p.id === game.hostPlayerId,
          isGuest: p.isGuest,
          totalScore: p.totalScore,
          isSpectating: p.isSpectating,
        })),
      );
      setFullSettings(game.settings);
      if (game.status === 2 && game.currentRoundIndex >= 0) {
        const r = game.rounds[game.currentRoundIndex];
        if (r) {
          setCurrentRound({
            roundNumber: r.roundNumber,
            letter: r.letter,
            categories: r.categories,
            startedAt: r.startedAt,
            endsAt: r.endedAt,
          });
        }
      }
      setPhase(STATUS_TO_PHASE[game.status] ?? 'lobby');
    } catch {
      localStorage.removeItem('active_game');
      setActiveGame(null);
    } finally {
      setIsRejoining(false);
    }
  }

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden px-4 py-12">
      {/* Colour blobs */}
      <motion.div
        className="pointer-events-none absolute rounded-full opacity-10"
        style={{ width: 128, height: 128, background: '#AD46FF', filter: 'blur(64px)', top: '8%', right: '10%', willChange: 'transform' }}
        animate={{ y: [0, -18, 0], scale: [1, 1.06, 1] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 0 }}
      />
      <motion.div
        className="pointer-events-none absolute rounded-full opacity-10"
        style={{ width: 160, height: 160, background: '#F6339A', filter: 'blur(64px)', bottom: '12%', left: '8%', willChange: 'transform' }}
        animate={{ y: [0, -18, 0], scale: [1, 1.06, 1] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
      />
      <motion.div
        className="pointer-events-none absolute rounded-full opacity-10"
        style={{ width: 96, height: 96, background: '#00B8DB', filter: 'blur(40px)', top: '45%', left: '5%', willChange: 'transform' }}
        animate={{ y: [0, -18, 0], scale: [1, 1.06, 1] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
      />

      {/* Decorative letter tiles */}
      <motion.div
        className="pointer-events-none absolute flex items-center justify-center rounded-2xl shadow-lg"
        style={{ width: 52, height: 52, background: 'rgba(255,255,255,0.10)', top: '10%', right: '6%', willChange: 'transform' }}
        animate={{ rotate: [2, -1, 2], y: [0, -12, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="font-black text-white text-2xl select-none">C</span>
      </motion.div>
      <motion.div
        className="pointer-events-none absolute flex items-center justify-center rounded-2xl shadow-lg"
        style={{ width: 52, height: 52, background: 'rgba(255,255,255,0.10)', bottom: '18%', right: '5%', willChange: 'transform' }}
        animate={{ rotate: [2, -1, 2], y: [0, -12, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="font-black text-white text-2xl select-none">A</span>
      </motion.div>
      <motion.div
        className="pointer-events-none absolute flex items-center justify-center rounded-2xl shadow-lg"
        style={{ width: 52, height: 52, background: 'rgba(255,255,255,0.10)', top: '50%', left: '4%', willChange: 'transform' }}
        animate={{ rotate: [2, -1, 2], y: [0, -12, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="font-black text-white text-2xl select-none">T</span>
      </motion.div>

      {/* Sparkle top-left */}
      <motion.div
        className="pointer-events-none absolute"
        style={{ top: '6%', left: '7%', willChange: 'transform' }}
        animate={{ y: [0, -8, 0], scale: [1, 1.1, 1], opacity: [0.5, 0.7, 0.5] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <SparkleIcon size={32} color="#FDE047" />
      </motion.div>

      <motion.div
        className="relative z-10 flex flex-col items-center gap-8 w-full max-w-[420px]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        {/* Title */}
        <div className="flex flex-col items-center gap-2">
          <div className="relative inline-block">
            <h1 className="text-6xl font-black text-white select-none leading-none">Categories</h1>
            <motion.div
              className="absolute -top-3 -right-6"
              style={{ opacity: 0.9, willChange: 'transform' }}
              animate={{ y: [0, -8, 0], scale: [1, 1.1, 1], opacity: [0.5, 0.7, 0.5] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <SparkleIcon size={28} color="#FDE047" />
            </motion.div>
          </div>
          <p className="text-xl font-medium" style={{ color: '#E9D4FF' }}>
            Beat your friends to the best answers
          </p>
        </div>

        {/* Active Game card */}
        {!checkingActiveGame && activeGame !== null && (
          <div
            className="w-full rounded-2xl px-5 py-4 flex flex-col gap-3"
            style={{ background: 'linear-gradient(to right, #FDC700, #FF8904)' }}
          >
            {/* Banner row */}
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-full" style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
                <BoltIcon />
              </div>
              <span className="font-bold text-white text-sm">Your game is still live!</span>
              <div className="ml-auto rounded-full px-3 py-1" style={{ background: '#ffffff' }}>
                <span className="font-mono font-bold text-sm tracking-widest uppercase" style={{ color: '#101828' }}>
                  {activeGame.joinCode}
                </span>
              </div>
            </div>
            {/* Playing as + rejoin */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold" style={{ color: '#7E2A0C' }}>Playing as</span>
                <span className="font-bold text-sm" style={{ color: '#7E2A0C' }}>{activeGame.displayName}</span>
              </div>
              <motion.button
                onClick={handleRejoin}
                disabled={isRejoining}
                className="flex items-center gap-1.5 rounded-2xl px-4 font-bold text-sm text-white transition-opacity disabled:opacity-60"
                style={{ height: 40, background: '#7E2A0C', flexShrink: 0 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                {isRejoining ? <Spinner /> : (
                  <>
                    <span>Rejoin Game</span>
                    <ArrowRightIcon />
                  </>
                )}
              </motion.button>
            </div>
          </div>
        )}

        {/* Main form card (frosted glass) */}
        <div
          className="w-full rounded-3xl px-6 py-6 flex flex-col gap-0"
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0px 25px 50px rgba(0,0,0,0.25)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Name input */}
          <div className="flex flex-col gap-2 mb-5">
            <label className="text-sm font-bold text-white" style={{ paddingLeft: 4 }}>
              Your Name
            </label>
            <input
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); setNameError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="e.g. Alex"
              maxLength={20}
              className="w-full rounded-2xl px-4 outline-none focus:ring-2 focus:ring-white/40 text-lg font-semibold"
              style={{
                height: 64,
                background: 'rgba(255,255,255,0.9)',
                border: 'none',
                color: '#101828',
              }}
            />
            {nameError && <p className="text-xs pl-1" style={{ color: '#fca5a5' }}>{nameError}</p>}
          </div>

          {/* Game code input */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-white" style={{ paddingLeft: 4 }}>
              Game Code
            </label>
            <input
              value={joinCode}
              onChange={(e) => { setJoinCodeInput(e.target.value.toUpperCase()); setJoinError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="e.g. K7P4"
              maxLength={8}
              className="w-full rounded-2xl px-4 outline-none focus:ring-2 focus:ring-[#DAB2FF] text-2xl font-black uppercase text-center"
              style={{
                height: 80,
                background: 'linear-gradient(168deg, #F3E8FF 0%, #FCE7F3 100%)',
                border: '4px solid #DAB2FF',
                color: '#59168B',
                letterSpacing: '7px',
              }}
            />
            {joinError ? (
              <p className="text-xs pl-1" style={{ color: '#fca5a5' }}>{joinError}</p>
            ) : (
              <p className="text-xs pl-1" style={{ color: 'rgba(255,255,255,0.6)' }}>Enter a code from your host</p>
            )}

            {/* Join Lobby button */}
            <motion.button
              onClick={handleJoin}
              disabled={isJoining}
              className="w-full rounded-2xl flex items-center justify-center gap-2 font-black text-xl text-white transition-opacity disabled:opacity-60"
              style={{
                height: 68,
                background: 'linear-gradient(to right, #00D3F3, #2B7FFF)',
                marginTop: 8,
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              {isJoining ? <Spinner /> : (
                <>
                  <span>Join Lobby</span>
                  <ArrowRightIcon />
                </>
              )}
            </motion.button>
          </div>

          {/* OR divider */}
          <div className="relative flex items-center gap-3 my-5">
            <div className="flex-1" style={{ height: 2, background: 'rgba(255,255,255,0.2)' }} />
            <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.6)' }}>OR</span>
            <div className="flex-1" style={{ height: 2, background: 'rgba(255,255,255,0.2)' }} />
          </div>

          {/* Create Game button */}
          <div className="flex flex-col gap-3">
            <motion.button
              onClick={handleCreate}
              disabled={isCreating}
              className="w-full rounded-2xl flex items-center justify-center gap-2 font-black text-xl text-white transition-opacity disabled:opacity-60"
              style={{
                height: 68,
                background: 'linear-gradient(to right, #F6339A, #9810FA)',
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              {isCreating ? <Spinner /> : (
                <>
                  <PlusIcon />
                  <span>Create Game</span>
                </>
              )}
            </motion.button>

            {createError && (
              <p className="text-center text-xs" style={{ color: '#fca5a5' }}>{createError}</p>
            )}
          </div>
        </div>

        {/* Footer badges */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center rounded-full" style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.10)' }}>
              <LockIcon />
            </div>
            <span className="text-sm font-medium" style={{ color: '#E9D4FF' }}>Private rooms</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center rounded-full" style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.10)' }}>
              <UsersIcon />
            </div>
            <span className="text-sm font-medium" style={{ color: '#E9D4FF' }}>Play with friends</span>
          </div>
        </div>

      </motion.div>
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
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 2L3 9h5l-1 5 6-7H8l1-5z" fill="white" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="7" width="10" height="8" rx="1.5" stroke="white" strokeWidth="1.5" />
      <path d="M5 7V5a3 3 0 016 0v2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 14v-1.5A2.5 2.5 0 008.5 10h-5A2.5 2.5 0 001 12.5V14M15 14v-1.5a2.5 2.5 0 00-2-2.45M11 2.13a2.5 2.5 0 010 4.74M6 7a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkleIcon({ size = 24, color = '#ffffff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 17l-6.2 4-2.4-7.3L3.2 9.2 11.6 9.2z M12 2l1.5 4.5M12 2l-1.5 4.5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M12 3C12 3 13.5 7 12 12C10.5 7 12 3 12 3Z M12 3C12 3 16 5 19 9C15 7.5 12 3 12 3Z M12 3C12 3 8 5 5 9C9 7.5 12 3 12 3Z"
        fill={color}
        opacity="0.4"
      />
      <circle cx="12" cy="12" r="2" fill={color} />
      <path d="M12 5v2M12 17v2M5 12H7M17 12h2M7.05 7.05l1.41 1.41M15.54 15.54l1.41 1.41M7.05 16.95l1.41-1.41M15.54 8.46l1.41-1.41" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

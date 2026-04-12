import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Zap, ArrowRight, Plus, Pencil, Check, Lock, Users } from 'lucide-react';
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
  const [isEditingName, setIsEditingName] = useState(() => !localStorage.getItem('displayName'));
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
        className="pointer-events-none absolute flex items-center justify-center rounded-2xl shadow-lg backdrop-blur-sm"
        style={{ width: 52, height: 52, background: 'rgba(255,255,255,0.10)', top: '10%', right: '6%', willChange: 'transform' }}
        animate={{ rotate: [2, -1, 2], y: [0, -12, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="font-black text-white text-2xl select-none">C</span>
      </motion.div>
      <motion.div
        className="pointer-events-none absolute flex items-center justify-center rounded-2xl shadow-lg backdrop-blur-sm"
        style={{ width: 52, height: 52, background: 'rgba(255,255,255,0.10)', bottom: '18%', right: '5%', willChange: 'transform' }}
        animate={{ rotate: [2, -1, 2], y: [0, -12, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="font-black text-white text-2xl select-none">A</span>
      </motion.div>
      <motion.div
        className="pointer-events-none absolute flex items-center justify-center rounded-2xl shadow-lg backdrop-blur-sm"
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
        <Sparkles size={32} className="text-yellow-300 opacity-60" />
      </motion.div>

      {/* Floating icon elements */}
      <motion.div
        className="pointer-events-none absolute top-32 right-16 text-pink-300 opacity-50"
        animate={{ y: [0, 15, 0], rotate: [0, -15, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      >
        <Sparkles size={24} />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute bottom-40 left-8 text-cyan-300 opacity-40"
        animate={{ y: [0, -10, 0], rotate: [0, 10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      >
        <Zap size={28} fill="currentColor" />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute top-1/3 right-8 text-lime-300 opacity-50"
        animate={{ y: [0, 20, 0], rotate: [0, -20, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
      >
        <Zap size={20} fill="currentColor" />
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
            <div className="absolute -top-3 -right-6">
              <Sparkles className="text-yellow-300 animate-pulse" size={28} fill="currentColor" />
            </div>
          </div>
          <p className="text-xl font-medium" style={{ color: '#E9D4FF' }}>
            Beat your friends to the best answers
          </p>
        </div>

        {/* Active Game card */}
        {!checkingActiveGame && activeGame !== null && (
          <div
            className="w-full rounded-3xl px-5 py-4 flex flex-col gap-3 shadow-2xl relative overflow-hidden"
            style={{ background: 'linear-gradient(to right, #FDC700, #FF8904)' }}
          >
            <div className="absolute inset-0 bg-white/20 backdrop-blur-sm" />
            <div className="relative z-10 flex flex-col gap-3">
              {/* Banner row */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center bg-white/30 rounded-full p-1.5" style={{ flexShrink: 0 }}>
                  <Zap size={20} className="text-orange-900" fill="currentColor" />
                </div>
                <span className="font-bold text-orange-900 text-sm">Your game is still live!</span>
                <div className="ml-auto rounded-full px-3 py-1 bg-white/90">
                  <span className="font-black text-sm tracking-wider uppercase text-orange-900">
                    {activeGame.joinCode}
                  </span>
                </div>
              </div>
              {/* Playing as + rejoin */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-orange-900/70 text-xs font-semibold">Playing as</span>
                  <span className="font-black text-lg text-orange-900">{activeGame.displayName}</span>
                </div>
                <motion.button
                  onClick={handleRejoin}
                  disabled={isRejoining}
                  className="flex items-center gap-1.5 bg-orange-900 text-white px-6 py-3 rounded-2xl font-bold transition-opacity disabled:opacity-60"
                  style={{ flexShrink: 0 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {isRejoining ? <Spinner /> : (
                    <>
                      <span>Rejoin Game</span>
                      <ArrowRight size={18} />
                    </>
                  )}
                </motion.button>
              </div>
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
            {!isEditingName && displayName.trim() !== '' ? (
              <div className="flex items-center justify-between bg-white/10 rounded-xl px-4 py-2.5 border border-white/10 h-12">
                <span className="text-white font-semibold text-sm truncate">
                  Welcome back, <span className="font-black">{displayName}</span>
                </span>
                <button
                  onClick={() => setIsEditingName(true)}
                  className="ml-2 text-white/60 hover:text-white transition-colors flex-shrink-0"
                >
                  <Pencil size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={displayName}
                  onChange={(e) => { setDisplayName(e.target.value); setNameError(''); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && displayName.trim() !== '') setIsEditingName(false);
                  }}
                  placeholder="e.g. Alex"
                  maxLength={20}
                  className="flex-1 rounded-2xl px-4 outline-none focus:ring-2 focus:ring-white/40 text-lg font-semibold"
                  style={{
                    height: 64,
                    background: 'rgba(255,255,255,0.9)',
                    border: 'none',
                    color: '#101828',
                  }}
                />
                {displayName.trim() !== '' && (
                  <button
                    onClick={() => setIsEditingName(false)}
                    className="flex items-center justify-center bg-cyan-500/20 text-cyan-300 rounded-xl p-2 hover:bg-cyan-500/30 transition-colors flex-shrink-0"
                    style={{ height: 64, width: 48 }}
                  >
                    <Check size={20} />
                  </button>
                )}
              </div>
            )}
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
              placeholder="ABCDEF"
              maxLength={6}
              className="w-full rounded-2xl py-5 px-5 outline-none bg-gradient-to-br from-purple-100 to-pink-100 border-4 border-purple-300 focus:border-pink-400 focus:ring-4 focus:ring-pink-400/30 text-2xl font-black uppercase text-center text-purple-900"
              style={{ letterSpacing: '7px' }}
            />
            {joinError && (
              <p className="text-xs pl-1" style={{ color: '#fca5a5' }}>{joinError}</p>
            )}

            {/* Join Lobby button */}
            <motion.button
              onClick={handleJoin}
              disabled={isJoining}
              className="w-full mt-2 rounded-2xl flex items-center justify-center gap-2 font-black text-xl text-white transition-opacity disabled:opacity-60 bg-gradient-to-r from-cyan-400 to-blue-500 py-5 relative overflow-hidden group shadow-lg hover:shadow-2xl"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              {isJoining ? <Spinner /> : (
                <>
                  <span className="relative z-10">Join Lobby</span>
                  <ArrowRight className="relative z-10" size={24} />
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
              className="w-full rounded-2xl flex items-center justify-center gap-2 font-black text-xl text-white transition-opacity disabled:opacity-60 bg-gradient-to-r from-pink-500 to-purple-600 py-5 relative overflow-hidden group shadow-lg hover:shadow-2xl"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              {isCreating ? <Spinner /> : (
                <>
                  <Plus className="relative z-10" size={24} />
                  <span className="relative z-10">Create Game</span>
                </>
              )}
            </motion.button>

            {createError && (
              <p className="text-center text-xs" style={{ color: '#fca5a5' }}>{createError}</p>
            )}
          </div>
        </div>

        {/* Footer badges */}
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center rounded-full backdrop-blur-sm" style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.10)' }}>
              <Lock size={16} className="text-white" />
            </div>
            <span className="text-sm font-medium" style={{ color: '#E9D4FF' }}>Private rooms</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center rounded-full backdrop-blur-sm" style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.10)' }}>
              <Users size={16} className="text-white" />
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

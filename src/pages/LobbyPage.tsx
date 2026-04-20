import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Zap, Users, Crown, ShieldCheck, Settings, Edit3, Play, Smile, Copy, Check, X, Plus, RotateCcw, ListTodo, Layers, Clock } from 'lucide-react';
import { useGame, type Player } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api, type GameSettings } from '../services/api';
import { startConnection, joinGameGroup, sendReaction, HubEvents } from '../services/signalr';
import { STATUS_TO_PHASE } from '../App';

const REACTIONS = ['🔥', '👏', '😂', '🎉', '💀'];
const SECONDS_OPTIONS = [30, 60, 90, 120];
const FALLBACK_CATEGORIES = [
  "A boy's name", "A girl's name", "A country", "An animal",
  "A city", "A food", "A TV show", "Something you find at school",
];

const CARD_SCHEMES = [
  { bar: 'linear-gradient(90deg, #fdc700, #ff6900)', avatarBg: '#fff085', glow: 'rgba(253,199,0,0.5)', gradient: 'from-yellow-400 to-orange-500' },
  { bar: 'linear-gradient(90deg, #00d3f3, #2b7fff)', avatarBg: '#a2f4fd', glow: 'rgba(0,211,243,0.5)', gradient: 'from-cyan-400 to-blue-500' },
  { bar: 'linear-gradient(90deg, #fb64b6, #ff2056)', avatarBg: '#fccee8', glow: 'rgba(251,100,182,0.5)', gradient: 'from-pink-400 to-rose-500' },
  { bar: 'linear-gradient(90deg, #9ae600, #00c950)', avatarBg: '#d8f999', glow: 'rgba(154,230,0,0.5)', gradient: 'from-lime-400 to-green-500' },
  { bar: 'linear-gradient(90deg, #ad46ff, #6129ff)', avatarBg: '#e4ccff', glow: 'rgba(173,70,255,0.5)', gradient: 'from-purple-400 to-violet-600' },
  { bar: 'linear-gradient(90deg, #00d3f3, #00b890)', avatarBg: '#a2f4e8', glow: 'rgba(0,211,243,0.5)', gradient: 'from-cyan-400 to-teal-500' },
];

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
}

export default function LobbyPage() {
  const {
    gameId, joinCode, playerId, isHost, players, settings,
    setFullSettings, addPlayer,
    setPhase, setCountdownStartAt, setCountdownInfo, setCurrentRound,
    isAwaitingHost, hostAwaitDeadline,
  } = useGame();

  const [draft, setDraft] = useState<GameSettings | null>(null);
  const [defaultCategories, setDefaultCategories] = useState<string[]>(() => {
    const cached = localStorage.getItem('categories_defaults');
    return cached ? (JSON.parse(cached) as string[]) : FALLBACK_CATEGORIES;
  });
  const [editingCategories, setEditingCategories] = useState(false);
  const [categoryInput, setCategoryInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [floaters, setFloaters] = useState<FloatingReaction[]>([]);
  const [nextId, setNextId] = useState(0);
  const [showReactions, setShowReactions] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hostAwaitSecondsLeft, setHostAwaitSecondsLeft] = useState<number | null>(null);
  const [modalDraft, setModalDraft] = useState<GameSettings | null>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);
  const isFirstModalDraftSet = useRef(true);

  // Init draft once from settings, falling back to defaults if categories are empty.
  const draftInitialized = useRef(false);
  useEffect(() => {
    if (draftInitialized.current || !settings) return;
    const cats = settings.categories.length > 0 ? settings.categories : defaultCategories;
    setDraft({ ...settings, categories: cats });
    draftInitialized.current = true;
  }, [settings, defaultCategories]);

  useEffect(() => {
    if (!gameId || !playerId) return;
    startConnection()
      .then(() => joinGameGroup(gameId, playerId))
      .then(() => api.getGame(gameId))
      .then((game) => {
        game.players.forEach((p) =>
          addPlayer({
            id: p.id,
            displayName: p.displayName,
            isHost: p.id === game.hostPlayerId,
            isGuest: p.isGuest,
            totalScore: p.totalScore,
            isSpectating: p.isSpectating,
          })
        );
        if (game.settings) {
          setFullSettings(game.settings);
          setDraft((d) => d ?? game.settings);
        }
        if (game.status === 1) {
          const r = game.rounds[0];
          if (r) setCountdownInfo(r.letter, r.roundNumber);
          setPhase('countdown');
        } else if (game.status === 2) {
          const r = game.rounds[game.currentRoundIndex];
          if (r) setCurrentRound({
            roundNumber: r.roundNumber,
            letter: r.letter,
            categories: r.categories,
            startedAt: r.startedAt,
            endsAt: r.endedAt,
          });
          setPhase('answering');
        } else if (game.status > 2) {
          setPhase(STATUS_TO_PHASE[game.status] ?? 'lobby');
        }
      })
      .catch(console.error);
  }, [gameId, playerId]);

  // Countdown for awaiting-host banner
  useEffect(() => {
    if (!isAwaitingHost || !hostAwaitDeadline) {
      setHostAwaitSecondsLeft(null);
      return;
    }
    const tick = () => {
      const secs = Math.max(0, Math.ceil((new Date(hostAwaitDeadline).getTime() - Date.now()) / 1000));
      setHostAwaitSecondsLeft(secs);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isAwaitingHost, hostAwaitDeadline]);

  // Fetch system defaults + host's saved categories
  useEffect(() => {
    const cached = localStorage.getItem('categories_defaults');
    if (cached) setDefaultCategories(JSON.parse(cached) as string[]);

    api.getDefaultCategories()
      .then(({ categories }) => {
        setDefaultCategories(categories);
        localStorage.setItem('categories_defaults', JSON.stringify(categories));
      })
      .catch(console.error);

    if (isHost && playerId) {
      api.getSavedCategories(playerId)
        .then(({ categories }) => {
          if (categories.length === 0) return;
          const base = settings ?? draft;
          if (base) applySettingsRef.current?.({ ...base, categories });
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useSignalREvent(HubEvents.PlayerJoined, (player) => { addPlayer(player as Player); });
  useSignalREvent(HubEvents.GameCountdown, (data) => {
    const { startAt, letter, roundNumber } = data as { startAt: string; letter: string; roundNumber: number };
    setCountdownStartAt(startAt);
    setCountdownInfo(letter, roundNumber);
    setPhase('countdown');
  });
  useSignalREvent(HubEvents.RoundStarted, (payload) => {
    const p = payload as { roundNumber: number; letter: string; categories: string[]; startedAt: string | null; endsAt: string | null };
    setCurrentRound(p);
    setPhase('answering');
  });
  useSignalREvent(HubEvents.EmojiReaction, (data) => { spawnFloater((data as { emoji: string }).emoji); });
  useSignalREvent(HubEvents.SettingsUpdated, (data) => {
    const s = (data as { settings: GameSettings }).settings;
    setFullSettings(s);
    if (!isHost) setDraft(s);
  });

  useEffect(() => {
    if (!settingsOpen || !modalDraft) return;
    if (isFirstModalDraftSet.current) {
      isFirstModalDraftSet.current = false;
      return;
    }
    applySettings(modalDraft);
  }, [modalDraft]);

  function spawnFloater(emoji: string) {
    const id = nextId;
    setNextId((n) => n + 1);
    const x = 10 + Math.random() * 80;
    setFloaters((f) => [...f, { id, emoji, x }]);
    setTimeout(() => setFloaters((f) => f.filter((r) => r.id !== id)), 2000);
  }

  const applySettingsRef = useRef<((s: GameSettings) => void) | null>(null);

  const applySettings = useCallback(async (newSettings: GameSettings) => {
    setDraft(newSettings);
    setFullSettings(newSettings);
    if (gameId && playerId) {
      api.updateSettings(gameId, playerId, newSettings).catch(console.error);
    }
  }, [gameId, playerId]);

  applySettingsRef.current = applySettings;

  async function handleCopy() {
    if (!joinCode) return;
    await navigator.clipboard.writeText(joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleStart() {
    if (!gameId || !playerId) return;
    setStarting(true);
    setStartError('');

    if (editingCategories) {
      let committed = draft!;
      const pending = categoryInput.trim();
      if (pending && !committed.categories.some((c) => c.toLowerCase() === pending.toLowerCase())) {
        committed = { ...committed, categories: [...committed.categories, pending] };
        setCategoryInput('');
      }
      await applySettings(committed);
      setEditingCategories(false);
    }

    try {
      await api.startGame(gameId, playerId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start game.');
    } finally {
      setStarting(false);
    }
  }

  async function handleReaction(emoji: string) {
    spawnFloater(emoji);
    if (gameId) sendReaction(gameId, emoji).catch(console.error);
    setShowReactions(false);
  }

  function handleModalAddCategory() {
    const trimmed = categoryInput.trim();
    if (!trimmed || !modalDraft) return;
    if (modalDraft.categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
    setModalDraft(prev => prev ? { ...prev, categories: [...prev.categories, trimmed] } : null);
    setCategoryInput('');
    categoryInputRef.current?.focus();
  }

  function handleModalRemoveCategory(cat: string) {
    if (!modalDraft) return;
    setModalDraft(prev => prev ? { ...prev, categories: prev.categories.filter((c) => c !== cat) } : null);
  }

  function handleSaveChanges() {
    setSettingsOpen(false);
    setCategoryInput('');
  }

  function initials(name: string) {
    return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  }

  const s = draft;
  const maxPlayers = s?.maxPlayers ?? 10;
  const waitingCount = Math.min(Math.max(0, maxPlayers - players.length), 1);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Decorative blur blobs */}
      <motion.div
        className="pointer-events-none absolute rounded-full opacity-20"
        style={{ width: 400, height: 400, background: '#ad46ff', filter: 'blur(100px)', top: '-80px', right: '-80px' }}
        animate={{ y: [0, -18, 0], scale: [1, 1.06, 1] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute rounded-full opacity-10"
        style={{ width: 350, height: 350, background: '#f6339a', filter: 'blur(100px)', bottom: '10%', left: '-80px' }}
        animate={{ y: [0, -18, 0], scale: [1, 1.06, 1] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
      />
      <motion.div
        className="pointer-events-none absolute rounded-full opacity-10"
        style={{ width: 200, height: 200, background: '#00b8db', filter: 'blur(60px)', top: '45%', left: '5%' }}
        animate={{ y: [0, -14, 0], scale: [1, 1.05, 1] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
      />

      {/* Ambient sparkles / zap */}
      <motion.div
        className="pointer-events-none fixed top-20 right-10 text-yellow-300 opacity-60"
        animate={{ y: [0, -15, 0], scale: [1, 1.2, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Sparkles size={24} />
      </motion.div>
      <motion.div
        className="pointer-events-none fixed top-40 left-12 text-pink-300 opacity-50"
        animate={{ y: [0, 20, 0], scale: [1, 0.8, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      >
        <Sparkles size={16} />
      </motion.div>
      <motion.div
        className="pointer-events-none fixed bottom-1/3 right-16 text-cyan-300 opacity-40"
        animate={{ y: [0, -25, 0], rotate: [0, 15, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      >
        <Zap size={28} fill="currentColor" />
      </motion.div>

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

      {/* Main content */}
      <motion.div
        className="relative z-10 max-w-[480px] mx-auto px-4 py-10 pb-40"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Room Ready badge */}
        <div className="flex justify-center mb-6">
          <div
            className="flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/10 rounded-full px-4 py-2"
            style={{ boxShadow: '0px 0px 15px 0px rgba(255,255,255,0.1)' }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-[#05df72]" style={{ boxShadow: '0 0 8px rgba(74,222,128,0.8)', opacity: 0.8 }} />
            <span className="text-sm font-bold uppercase tracking-[1.25px] text-white/90">Room Ready</span>
          </div>
        </div>

        {/* Awaiting host banner */}
        {isAwaitingHost && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl px-5 py-3 mb-4 flex items-center gap-3"
            style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)' }}
          >
            <span className="inline-block w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-amber-300">Waiting for host to return...</p>
              <p className="text-xs text-amber-200/60">
                {hostAwaitSecondsLeft !== null
                  ? `Host has ${hostAwaitSecondsLeft}s to return, or a new host will be selected.`
                  : 'A new host will be selected shortly.'}
              </p>
            </div>
          </motion.div>
        )}

        {/* Room code card */}
        <motion.div
          className="rounded-3xl p-6 mb-3 text-center overflow-hidden relative backdrop-blur-xl shadow-2xl cursor-pointer"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '2px solid rgba(255,255,255,0.2)',
          }}
          onClick={handleCopy}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          <div
            className="absolute inset-0 pointer-events-none opacity-50"
            style={{ background: 'linear-gradient(90deg, rgba(0,184,219,0.1), rgba(173,70,255,0.1), rgba(246,51,154,0.1))' }}
          />
          <div className="relative flex items-center justify-center gap-4">
            <span
              className="font-mono font-black text-5xl tracking-[0.2em] text-white"
              style={{ textShadow: '0 0 30px rgba(255,255,255,0.3)' }}
            >
              {joinCode}
            </span>
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all flex-shrink-0"
              style={{
                background: copied ? 'rgba(0,201,80,0.2)' : 'rgba(255,255,255,0.2)',
                border: copied ? '1px solid rgba(0,201,80,0.4)' : 'none',
              }}
            >
              {copied
                ? <Check size={16} className="text-green-400" />
                : <Copy size={16} className="text-white/70" />
              }
            </div>
          </div>
          {copied && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: -10 }}
              className="absolute -top-10 left-1/2 -translate-x-1/2 bg-green-500 text-white text-sm font-bold px-3 py-1 rounded-full shadow-lg whitespace-nowrap"
            >
              Copied!
            </motion.div>
          )}
        </motion.div>
        <p className="text-center text-sm font-medium text-[rgba(233,212,255,0.8)] mb-8">
          {copied ? '✓ Copied to clipboard!' : 'Share this code with your friends to join'}
        </p>

        {/* Players section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4 px-2">
            <Users size={20} className="text-cyan-400" />
            <h2 className="font-bold text-white text-xl">Players in Lobby</h2>
            <div className="rounded-full px-2.5 py-0.5 text-xs font-black text-white ml-1" style={{ background: 'rgba(255,255,255,0.2)' }}>
              {players.length}/{maxPlayers}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {players.map((p, i) => {
              const scheme = CARD_SCHEMES[i % CARD_SCHEMES.length];
              return (
                <motion.div
                  key={p.id}
                  className="relative group"
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.3, delay: i * 0.08, type: 'spring', stiffness: 300, damping: 25 }}
                >
                  {/* Glow */}
                  <div
                    className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${scheme.gradient} opacity-50 blur-lg group-hover:opacity-70 transition-opacity`}
                    style={{ transform: 'scale(0.9) translateY(4px)' }}
                  />
                  <div
                    className="relative rounded-3xl overflow-hidden flex flex-col items-center pt-0 pb-5 backdrop-blur-md"
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      boxShadow: '0px 20px 25px -5px rgba(0,0,0,0.1), 0px 8px 10px -6px rgba(0,0,0,0.1)',
                      minHeight: '138px',
                    }}
                  >
                    {/* Gradient top bar */}
                    <div className="w-full h-1.5 flex-shrink-0" style={{ background: scheme.bar }} />
                    <div className="flex flex-col items-center pt-4 gap-2 w-full">
                      {/* Avatar with optional crown */}
                      <div className="relative">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center border-4 border-[rgba(255,255,255,0.2)] p-1">
                          <div
                            className="w-full h-full rounded-full flex items-center justify-center text-2xl font-black"
                            style={{
                              background: scheme.avatarBg,
                              color: 'rgba(0,0,0,0.4)',
                              boxShadow: 'inset 0px 2px 4px 0px rgba(0,0,0,0.05)',
                            }}
                          >
                            {initials(p.displayName)}
                          </div>
                        </div>
                        {p.isHost && (
                          <div
                            className="absolute -top-4 -right-1 w-8 h-8 rounded-full flex items-center justify-center rotate-12"
                            style={{
                              background: '#fdc700',
                              border: '2px solid #312c85',
                              boxShadow: '0 10px 15px 0 rgba(0,0,0,0.1), 0 4px 6px 0 rgba(0,0,0,0.1)',
                            }}
                          >
                            <Crown size={14} className="text-yellow-900" fill="currentColor" />
                          </div>
                        )}
                      </div>
                      <span className="text-[18px] font-bold text-white text-center px-2 truncate max-w-full leading-snug">
                        {p.displayName}
                        {p.id === playerId && <span className="text-[rgba(255,255,255,0.4)] font-normal text-sm"> (you)</span>}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            {/* Waiting slots */}
            {Array.from({ length: waitingCount }).map((_, i) => (
              <div
                key={`waiting-${i}`}
                className="rounded-3xl flex flex-col items-center justify-center py-6 gap-2"
                style={{
                  border: '2px dashed rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.05)',
                  minHeight: '138px',
                }}
              >
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <div className="flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <div
                        key={d}
                        className="w-2 h-2 rounded-full bg-white/40 animate-bounce"
                        style={{ animationDelay: `${d * 150}ms` }}
                      />
                    ))}
                  </div>
                </div>
                <span className="text-sm font-bold text-white/40">Waiting...</span>
              </div>
            ))}
          </div>
        </div>

        {/* Host banner */}
        {isHost && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex items-center justify-center gap-2 rounded-full px-5 py-2.5 mb-6"
            style={{ background: 'rgba(240,177,0,0.1)', border: '1px solid rgba(240,177,0,0.2)' }}
          >
            <ShieldCheck size={16} className="text-yellow-400" />
            <span className="text-sm font-semibold" style={{ color: 'rgba(255,240,133,0.9)' }}>
              You're the host • You choose when to start
            </span>
          </motion.div>
        )}

        {/* Game Setup card */}
        {s && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="rounded-3xl overflow-hidden mb-6 shadow-2xl"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              backdropFilter: 'blur(12px)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-5">
              <div className="flex items-center gap-2">
                <Settings size={20} className="text-pink-400" />
                <h3 className="font-bold text-white text-xl">Game Setup</h3>
              </div>
              {isHost && (
                <motion.button
                  onClick={() => { isFirstModalDraftSet.current = true; setModalDraft(s ? { ...s } : null); setSettingsOpen(true); }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-full transition-colors hover:bg-white/20"
                  style={{ background: 'rgba(255,255,255,0.1)', color: 'white' }}
                >
                  <Edit3 size={14} />
                  Edit
                </motion.button>
              )}
            </div>
            <div className="flex flex-col gap-3 px-5 pb-5">
              {/* Categories tile — full width with chip preview */}
              <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(173,70,255,0.2)' }}>
                    <ListTodo size={20} className="text-purple-400" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.6px] text-white/50">Categories</span>
                    <span className="text-sm font-black text-white">{s.categories.length} Selected</span>
                  </div>
                </div>
                {s.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {s.categories.slice(0, 6).map((cat) => (
                      <span
                        key={cat}
                        className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-[#e9d4ff]"
                        style={{ background: 'rgba(173,70,255,0.2)', border: '1px solid rgba(173,70,255,0.3)' }}
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {/* Rounds + Timer side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl p-3 flex items-center gap-3" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(43,127,255,0.2)' }}>
                    <Layers size={20} className="text-blue-400" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.6px] text-white/50">Rounds</span>
                    <span className="text-sm font-black text-white">{s.maxRounds} Rounds</span>
                  </div>
                </div>
                <div className="rounded-2xl p-3 flex items-center gap-3" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,105,0,0.2)' }}>
                    <Clock size={20} className="text-orange-400" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.6px] text-white/50">Timer</span>
                    <span className="text-sm font-black text-white">
                      {s.isTimedMode ? `${s.roundDurationSeconds} Seconds` : 'Relaxed'}
                    </span>
                  </div>
                </div>
              </div>
              {/* Game Mode — full width */}
              <div className="rounded-2xl p-3 flex items-center gap-3" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(124,207,0,0.2)' }}>
                  <Zap size={20} className="text-lime-400" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.6px] text-white/50">Game Mode</span>
                  <span className="text-sm font-black text-white">{s.isTimedMode ? 'Timed' : 'Relaxed'}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Bottom info */}
        <div className="text-center mb-4">
          <p className="text-sm font-bold" style={{ color: '#05df72' }}>
            {players.length} of {maxPlayers} players joined.
          </p>
          <p className="text-sm font-medium text-white/70 mt-0.5">
            {isHost ? 'Start now or wait for more players...' : 'Waiting for the host to start…'}
          </p>
        </div>

        {/* Floating reactions area */}
        <div className="relative">
          <div className="absolute -top-16 right-0 w-full h-16 pointer-events-none">
            <AnimatePresence>
              {floaters.map((reaction) => (
                <motion.div
                  key={reaction.id}
                  initial={{ opacity: 1, y: 20, x: reaction.x, scale: 0.5 }}
                  animate={{ opacity: 0, y: -80, scale: 1.5 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                  className="absolute bottom-0 right-4 text-3xl drop-shadow-lg"
                >
                  {reaction.emoji}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Action row */}
          <div className="flex gap-3 items-center">
            <button
              onClick={() => setShowReactions((v) => !v)}
              className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors hover:bg-white/20"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                boxShadow: '0px 10px 15px 0px rgba(0,0,0,0.1), 0px 4px 6px 0px rgba(0,0,0,0.1)',
              }}
            >
              <Smile size={22} className="text-white/70" />
            </button>

            {isHost ? (
              <motion.button
                onClick={handleStart}
                disabled={starting || players.length < 1 || isAwaitingHost}
                className="flex-1 h-16 rounded-2xl font-black text-2xl text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden relative group shadow-lg hover:shadow-2xl bg-gradient-to-r from-cyan-400 to-blue-500"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                {starting ? (
                  <span className="relative z-10">Starting…</span>
                ) : (
                  <>
                    <Play className="relative z-10" size={20} fill="currentColor" />
                    <span className="relative z-10">Start Game</span>
                  </>
                )}
              </motion.button>
            ) : (
              <div
                className="flex-1 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <span className="text-sm text-white/50">Waiting for the host to start…</span>
              </div>
            )}
          </div>
        </div>

        {startError && (
          <p className="text-center text-xs text-[#f87171] mt-2">{startError}</p>
        )}
      </motion.div>

      {/* Emoji picker (floating above action row) */}
      {showReactions && (
        <div
          className="fixed bottom-20 left-6 z-50 flex flex-col gap-1 rounded-2xl p-2 shadow-lg"
          style={{ background: 'rgba(30,26,77,0.95)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)', animation: 'fadeIn 0.15s ease' }}
        >
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => handleReaction(emoji)}
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl hover:bg-white/10 transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      {showReactions && (
        <div className="fixed inset-0 z-40" onClick={() => setShowReactions(false)} />
      )}

      {/* Settings modal (host only) */}
      <AnimatePresence>
        {settingsOpen && modalDraft && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-indigo-950/80 backdrop-blur-sm" onClick={() => setSettingsOpen(false)} />
            <motion.div
              className="relative w-full max-w-[448px] rounded-3xl overflow-hidden border-2 border-indigo-400/30"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              style={{
                background: '#1e1b4b',
                boxShadow: '0px 0px 50px 0px rgba(0,0,0,0.5)',
              }}
            >
              {/* Top accent bar */}
              <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #f6339a, #ad46ff 50%, #00b8db)' }} />

              <div className="px-6 pt-6 pb-6 overflow-y-auto max-h-[calc(90vh-4px)]">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <Settings size={24} className="text-pink-400" />
                    <h2 className="font-black text-white text-2xl">Game Setup</h2>
                  </div>
                  <button
                    onClick={() => setSettingsOpen(false)}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
                    style={{ background: 'rgba(255,255,255,0.05)' }}
                  >
                    <X size={16} className="text-white/70" />
                  </button>
                </div>

                {/* Number of Rounds */}
                <div className="flex flex-col gap-3 mb-6">
                  <div className="flex items-center gap-1.5">
                    <Layers size={16} className="text-blue-400" />
                    <span className="text-[14px] font-bold uppercase tracking-[0.55px] text-[#a3b3ff]">Number of Rounds</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 3, 5, 10].map((n) => {
                      const selected = modalDraft.maxRounds === n;
                      return (
                        <button
                          key={n}
                          onClick={() => setModalDraft(prev => prev ? { ...prev, maxRounds: n } : null)}
                          className="h-[54px] rounded-[14px] font-bold text-[18px] transition-all"
                          style={selected ? {
                            background: '#2b7fff',
                            border: '1px solid #51a2ff',
                            color: 'white',
                            boxShadow: '0px 0px 15px 0px rgba(59,130,246,0.5)',
                          } : {
                            background: 'rgba(0,0,0,0.2)',
                            border: '1px solid transparent',
                            color: 'rgba(255,255,255,0.6)',
                          }}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Game Mode */}
                <div className="flex flex-col gap-3 mb-6">
                  <div className="flex items-center gap-1.5">
                    <Zap size={16} className="text-lime-400" />
                    <span className="text-[14px] font-bold uppercase tracking-[0.55px] text-[#a3b3ff]">Game Mode</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setModalDraft(prev => prev ? { ...prev, isTimedMode: true } : null)}
                      className="h-[50px] rounded-[14px] font-bold text-[16px] flex items-center justify-center gap-2 transition-all"
                      style={modalDraft.isTimedMode ? {
                        background: '#7ccf00',
                        border: '1px solid #9ae600',
                        color: '#192e03',
                        boxShadow: '0px 0px 15px 0px rgba(132,204,22,0.5)',
                      } : {
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid transparent',
                        color: 'rgba(255,255,255,0.6)',
                      }}
                    >
                      Timed
                      {modalDraft.isTimedMode && <Check size={18} strokeWidth={3} />}
                    </button>
                    <button
                      onClick={() => setModalDraft(prev => prev ? { ...prev, isTimedMode: false } : null)}
                      className="h-[50px] rounded-[14px] font-bold text-[16px] flex items-center justify-center gap-2 transition-all"
                      style={!modalDraft.isTimedMode ? {
                        background: '#6129ff',
                        border: '1px solid rgba(124,134,255,0.5)',
                        color: 'white',
                        boxShadow: '0px 0px 15px 0px rgba(97,41,255,0.5)',
                      } : {
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid transparent',
                        color: 'rgba(255,255,255,0.6)',
                      }}
                    >
                      Relaxed
                      {!modalDraft.isTimedMode && <Check size={18} strokeWidth={3} />}
                    </button>
                  </div>
                </div>

                {/* Time Per Round (timed mode only) — animated */}
                <div
                  style={{
                    overflow: 'hidden',
                    maxHeight: modalDraft.isTimedMode ? '200px' : '0px',
                    marginBottom: modalDraft.isTimedMode ? '24px' : '0px',
                    transition: 'max-height 0.3s ease, margin-bottom 0.3s ease',
                  }}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-1.5">
                      <Clock size={16} className="text-orange-400" />
                      <span className="text-[14px] font-bold uppercase tracking-[0.55px] text-[#a3b3ff]">Time Per Round</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {SECONDS_OPTIONS.map((sec) => {
                        const selected = modalDraft.roundDurationSeconds === sec;
                        return (
                          <button
                            key={sec}
                            onClick={() => setModalDraft(prev => prev ? { ...prev, roundDurationSeconds: sec } : null)}
                            className="h-[54px] rounded-[14px] font-bold text-[18px] transition-all"
                            style={selected ? {
                              background: '#ff6900',
                              border: '1px solid #ff8904',
                              color: 'white',
                              boxShadow: '0px 0px 15px 0px rgba(249,115,22,0.5)',
                            } : {
                              background: 'rgba(0,0,0,0.2)',
                              border: '1px solid transparent',
                              color: 'rgba(255,255,255,0.6)',
                            }}
                          >
                            {sec}s
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Custom Categories */}
                <div className="flex flex-col gap-3 mb-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <ListTodo size={16} className="text-purple-400" />
                      <span className="text-[14px] font-bold uppercase tracking-[0.55px] text-[#a3b3ff]">Custom Categories</span>
                    </div>
                    <button
                      onClick={() => setModalDraft({ ...modalDraft, categories: [...defaultCategories] })}
                      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12px] text-white/40 hover:text-white/70 transition-colors"
                    >
                      <RotateCcw size={10} />
                      Restore Defaults
                    </button>
                  </div>
                  <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="flex flex-wrap gap-2 max-h-[140px] overflow-y-auto pr-1">
                      <AnimatePresence>
                        {modalDraft.categories.map((cat) => (
                          <motion.span
                            key={cat}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px]"
                            style={{ background: 'rgba(173,70,255,0.2)', border: '1px solid rgba(173,70,255,0.3)' }}
                          >
                            <span className="text-[12px] font-bold text-[#e9d4ff]">{cat}</span>
                            <button
                              onClick={() => handleModalRemoveCategory(cat)}
                              className="flex items-center justify-center text-purple-300/50 hover:text-[#e9d4ff] transition-colors leading-none"
                            >
                              <X size={10} strokeWidth={3} />
                            </button>
                          </motion.span>
                        ))}
                      </AnimatePresence>
                    </div>
                    <div className="flex gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
                      <input
                        ref={categoryInputRef}
                        value={categoryInput}
                        onChange={(e) => setCategoryInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleModalAddCategory()}
                        placeholder="Add category..."
                        className="flex-1 rounded-[10px] px-3 py-2 text-[14px] font-medium text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 transition-colors"
                        style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)' }}
                      />
                      <button
                        onClick={handleModalAddCategory}
                        className="w-[42px] h-[38px] rounded-[10px] flex items-center justify-center flex-shrink-0 transition-colors hover:bg-purple-500/30"
                        style={{ background: 'rgba(173,70,255,0.2)', border: '1px solid rgba(173,70,255,0.3)' }}
                      >
                        <Plus size={16} className="text-[#e9d4ff]" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Save Changes */}
                <motion.button
                  onClick={handleSaveChanges}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full h-[60px] rounded-[16px] font-black text-[18px] text-white flex items-center justify-center transition-all"
                  style={{
                    background: 'linear-gradient(90deg, #f6339a, #ad46ff)',
                    boxShadow: '0px 4px 20px 0px rgba(236,72,153,0.4)',
                  }}
                >
                  Done
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

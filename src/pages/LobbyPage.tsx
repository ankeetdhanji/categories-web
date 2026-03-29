import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  { bar: 'linear-gradient(90deg, #fdc700, #ff6900)', avatarBg: '#fff085', glow: 'rgba(253,199,0,0.5)' },
  { bar: 'linear-gradient(90deg, #00d3f3, #2b7fff)', avatarBg: '#a2f4fd', glow: 'rgba(0,211,243,0.5)' },
  { bar: 'linear-gradient(90deg, #fb64b6, #ff2056)', avatarBg: '#fccee8', glow: 'rgba(251,100,182,0.5)' },
  { bar: 'linear-gradient(90deg, #9ae600, #00c950)', avatarBg: '#d8f999', glow: 'rgba(154,230,0,0.5)' },
  { bar: 'linear-gradient(90deg, #ad46ff, #6129ff)', avatarBg: '#e4ccff', glow: 'rgba(173,70,255,0.5)' },
  { bar: 'linear-gradient(90deg, #00d3f3, #00b890)', avatarBg: '#a2f4e8', glow: 'rgba(0,211,243,0.5)' },
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
  } = useGame();

  const [draft, setDraft] = useState<GameSettings | null>(null);
  const [defaultCategories, setDefaultCategories] = useState<string[]>(() => {
    const cached = localStorage.getItem('categories_defaults');
    return cached ? (JSON.parse(cached) as string[]) : FALLBACK_CATEGORIES;
  });
  const [editingCategories, setEditingCategories] = useState(false);
  const [categoryInput, setCategoryInput] = useState('');
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [floaters, setFloaters] = useState<FloatingReaction[]>([]);
  const [nextId, setNextId] = useState(0);
  const [showReactions, setShowReactions] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState<GameSettings | null>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);

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

  function spawnFloater(emoji: string) {
    const id = nextId;
    setNextId((n) => n + 1);
    const x = 10 + Math.random() * 80;
    setFloaters((f) => [...f, { id, emoji, x }]);
    setTimeout(() => setFloaters((f) => f.filter((r) => r.id !== id)), 2000);
  }

  function categoriesDiffer(a: string[], b: string[]) {
    if (a.length !== b.length) return true;
    return [...a].sort().join('|') !== [...b].sort().join('|');
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

  async function handleSaveMyDefaults() {
    if (!playerId || !draft) return;
    await api.saveMyCategories(playerId, draft.categories);
    setSaveConfirmed(true);
    setTimeout(() => setSaveConfirmed(false), 2000);
  }

  function handleAddCategory() {
    const trimmed = categoryInput.trim();
    if (!trimmed || !draft) return;
    if (draft.categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
    const updated: GameSettings = { ...draft, categories: [...draft.categories, trimmed] };
    setDraft(updated);
    setCategoryInput('');
    categoryInputRef.current?.focus();
    applySettings(updated);
  }

  function handleRemoveCategory(cat: string) {
    if (!draft) return;
    const updated = { ...draft, categories: draft.categories.filter((c) => c !== cat) };
    setDraft(updated);
    applySettings(updated);
  }

  function handleModalAddCategory() {
    const trimmed = categoryInput.trim();
    if (!trimmed || !modalDraft) return;
    if (modalDraft.categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
    setModalDraft({ ...modalDraft, categories: [...modalDraft.categories, trimmed] });
    setCategoryInput('');
    categoryInputRef.current?.focus();
  }

  function handleModalRemoveCategory(cat: string) {
    if (!modalDraft) return;
    setModalDraft({ ...modalDraft, categories: modalDraft.categories.filter((c) => c !== cat) });
  }

  function handleSaveChanges() {
    if (!modalDraft) return;
    applySettings(modalDraft);
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
    <div
      className="relative min-h-screen overflow-x-hidden"
      style={{ background: 'linear-gradient(136.76deg, #1e1a4d 0%, #59168b 50%, #312c85 100%)' }}
    >
      {/* Decorative blur blobs */}
      <div
        className="pointer-events-none fixed top-0 right-0 w-[400px] h-[400px] rounded-full"
        style={{ background: '#ad46ff', filter: 'blur(100px)', opacity: 0.2, transform: 'translate(30%, -30%)' }}
      />
      <div
        className="pointer-events-none fixed bottom-0 left-0 w-[350px] h-[350px] rounded-full"
        style={{ background: '#f6339a', filter: 'blur(100px)', opacity: 0.1, transform: 'translate(-30%, 30%)' }}
      />
      {/* Sparkle icons */}
      <SparkleIcon className="pointer-events-none fixed top-16 right-12 opacity-20 text-white" size={20} />
      <SparkleIcon className="pointer-events-none fixed top-32 right-28 opacity-10 text-white" size={12} />
      <SparkleIcon className="pointer-events-none fixed bottom-40 right-8 opacity-15 text-white" size={16} />

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
            className="flex items-center gap-2 bg-[rgba(255,255,255,0.1)] border border-[rgba(255,255,255,0.1)] rounded-full px-4 py-2"
            style={{ boxShadow: '0px 0px 15px 0px rgba(255,255,255,0.1)' }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-[#05df72]" style={{ boxShadow: '0 0 8px rgba(74,222,128,0.8)', opacity: 0.61 }} />
            <span className="text-sm font-bold uppercase tracking-[1.25px] text-[rgba(255,255,255,0.9)]">Room Ready</span>
          </div>
        </div>

        {/* Room code card */}
        <div
          className="rounded-2xl p-6 mb-3 text-center overflow-hidden relative"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '2px solid rgba(255,255,255,0.2)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0px 25px 50px -12px rgba(0,0,0,0.25)',
          }}
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
            <motion.button
              onClick={handleCopy}
              className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all flex-shrink-0"
              style={{
                background: copied ? 'rgba(0,201,80,0.2)' : 'rgba(255,255,255,0.2)',
                border: copied ? '1px solid rgba(0,201,80,0.4)' : 'none',
              }}
              title="Copy room code"
              whileTap={{ scale: 0.9 }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </motion.button>
          </div>
        </div>
        <p className="text-center text-sm font-medium text-[rgba(233,212,255,0.8)] mb-8">
          {copied ? '✓ Copied to clipboard!' : 'Share this code with your friends to join'}
        </p>

        {/* Players section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4 px-2">
            <PeopleIcon />
            <h2 className="font-bold text-white text-xl">Players in Lobby</h2>
            <div
              className="rounded-full px-2.5 py-0.5 text-xs font-black text-white ml-1"
              style={{ background: 'rgba(255,255,255,0.2)' }}
            >
              {players.length}/{maxPlayers}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {players.map((p, i) => {
              const scheme = CARD_SCHEMES[i % CARD_SCHEMES.length];
              return (
                <motion.div
                  key={p.id}
                  className="relative"
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.3, delay: i * 0.08, type: 'spring', stiffness: 300, damping: 25 }}
                >
                  {/* Glow */}
                  <div
                    className="absolute inset-0 rounded-3xl"
                    style={{
                      background: scheme.bar,
                      filter: 'blur(16px)',
                      opacity: 0.5,
                      transform: 'scale(0.9) translateY(4px)',
                    }}
                  />
                  <div
                    className="relative rounded-3xl overflow-hidden flex flex-col items-center pt-0 pb-5"
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
                        <div
                          className="w-16 h-16 rounded-full flex items-center justify-center border-4 border-[rgba(255,255,255,0.2)] p-1"
                        >
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
                            <CrownIconGold />
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
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.1)' }}
                >
                  <div className="flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <div
                        key={d}
                        className="w-2 h-2 rounded-full bg-[rgba(255,255,255,0.4)]"
                        style={{ animation: `pulse 1.5s ease-in-out ${d * 0.3}s infinite` }}
                      />
                    ))}
                  </div>
                </div>
                <span className="text-sm font-bold text-[rgba(255,255,255,0.4)]">Waiting...</span>
              </div>
            ))}
          </div>
        </div>

        {/* Host banner */}
        {isHost && (
          <div
            className="flex items-center justify-center gap-2 rounded-full px-5 py-2.5 mb-6"
            style={{
              background: 'rgba(240,177,0,0.1)',
              border: '1px solid rgba(240,177,0,0.2)',
            }}
          >
            <ShieldIcon />
            <span className="text-sm font-semibold" style={{ color: 'rgba(255,240,133,0.9)' }}>
              You're the host • You choose when to start
            </span>
          </div>
        )}

        {/* Game Setup card */}
        {s && (
          <div
            className="rounded-3xl overflow-hidden mb-6"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              backdropFilter: 'blur(12px)',
              boxShadow: '0px 25px 50px -12px rgba(0,0,0,0.25)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-5">
              <div className="flex items-center gap-2">
                <SettingsIcon />
                <h3 className="font-bold text-white text-xl">Game Setup</h3>
              </div>
              {isHost && (
                <button
                  onClick={() => { setModalDraft(s ? { ...s } : null); setSettingsOpen(true); }}
                  className="flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-full transition-colors"
                  style={{ background: 'rgba(255,255,255,0.1)', color: 'white' }}
                >
                  <PencilIcon />
                  Edit
                </button>
              )}
            </div>
            <div className="flex flex-col gap-3 px-5 pb-5">
              {/* Categories tile — full width with chip preview */}
              <div
                className="rounded-2xl p-3 flex flex-col gap-2"
                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(173,70,255,0.2)' }}
                  >
                    <CategoriesIcon />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.6px] text-[rgba(255,255,255,0.5)]">Categories</span>
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
                <div
                  className="rounded-2xl p-3 flex items-center gap-3"
                  style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div
                    className="w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(43,127,255,0.2)' }}
                  >
                    <RoundsIcon />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.6px] text-[rgba(255,255,255,0.5)]">Rounds</span>
                    <span className="text-sm font-black text-white">{s.maxRounds} Rounds</span>
                  </div>
                </div>
                <div
                  className="rounded-2xl p-3 flex items-center gap-3"
                  style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div
                    className="w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(255,105,0,0.2)' }}
                  >
                    <TimerIcon />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.6px] text-[rgba(255,255,255,0.5)]">Timer</span>
                    <span className="text-sm font-black text-white">
                      {s.isTimedMode ? `${s.roundDurationSeconds} Seconds` : 'Relaxed'}
                    </span>
                  </div>
                </div>
              </div>
              {/* Game Mode — full width */}
              <div
                className="rounded-2xl p-3 flex items-center gap-3"
                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div
                  className="w-9 h-9 rounded-[14px] flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(124,207,0,0.2)' }}
                >
                  <GameModeIcon />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.6px] text-[rgba(255,255,255,0.5)]">Game Mode</span>
                  <span className="text-sm font-black text-white">{s.isTimedMode ? 'Timed' : 'Relaxed'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bottom info */}
        <div className="text-center mb-4">
          <p className="text-sm font-bold" style={{ color: '#05df72' }}>
            {players.length} of {maxPlayers} players joined.
          </p>
          <p className="text-sm font-medium text-[rgba(255,255,255,0.7)] mt-0.5">
            {isHost ? 'Start now or wait for more players...' : 'Waiting for the host to start…'}
          </p>
        </div>

        {/* Action row */}
        <div className="flex gap-3 items-center">
          <button
            onClick={() => setShowReactions((v) => !v)}
            className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              boxShadow: '0px 10px 15px 0px rgba(0,0,0,0.1), 0px 4px 6px 0px rgba(0,0,0,0.1)',
            }}
          >
            <SmileIcon />
          </button>

          {isHost ? (
            <motion.button
              onClick={handleStart}
              disabled={starting || players.length < 1}
              className="flex-1 h-16 rounded-2xl font-black text-2xl text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden relative"
              style={{
                background: 'linear-gradient(90deg, #00d3f3, #2b7fff)',
                boxShadow: '0px 8px 30px 0px rgba(6,182,212,0.4)',
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              {starting ? 'Starting…' : (
                <>
                  <PlayIcon />
                  Start Game
                </>
              )}
            </motion.button>
          ) : (
            <div
              className="flex-1 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              <span className="text-sm text-[rgba(255,255,255,0.5)]">Waiting for the host to start…</span>
            </div>
          )}
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
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl hover:bg-[rgba(255,255,255,0.1)] transition-colors"
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
          <div className="absolute inset-0 bg-[rgba(30,26,77,0.8)] backdrop-blur-sm" onClick={() => setSettingsOpen(false)} />
          <motion.div
            className="relative w-full max-w-[448px] rounded-[24px] overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={{
              background: '#312c85',
              border: '2px solid rgba(124,134,255,0.3)',
              boxShadow: '0px 0px 50px 0px rgba(0,0,0,0.5)',
            }}
          >
            {/* Top accent bar */}
            <div className="h-1 w-full flex-shrink-0" style={{ background: 'linear-gradient(90deg, #f6339a, #ad46ff 50%, #00b8db)' }} />

            <div className="px-6 pt-6 pb-6 overflow-y-auto max-h-[calc(90vh-4px)]">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <SettingsIconPink />
                  <h2 className="font-black text-white text-2xl">Game Setup</h2>
                </div>
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-[rgba(255,255,255,0.1)]"
                  style={{ background: 'rgba(255,255,255,0.05)' }}
                >
                  <XIcon />
                </button>
              </div>

              {/* Number of Rounds */}
              <div className="flex flex-col gap-3 mb-6">
                <div className="flex items-center gap-1.5">
                  <RoundsIcon />
                  <span className="text-[14px] font-bold uppercase tracking-[0.55px] text-[#a3b3ff]">Number of Rounds</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 3, 5, 10].map((n) => {
                    const selected = modalDraft.maxRounds === n;
                    return (
                      <button
                        key={n}
                        onClick={() => setModalDraft({ ...modalDraft, maxRounds: n })}
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
                  <GameModeIcon />
                  <span className="text-[14px] font-bold uppercase tracking-[0.55px] text-[#a3b3ff]">Game Mode</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setModalDraft({ ...modalDraft, isTimedMode: true })}
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
                    {modalDraft.isTimedMode && <ModalCheckIcon />}
                  </button>
                  <button
                    onClick={() => setModalDraft({ ...modalDraft, isTimedMode: false })}
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
                    {!modalDraft.isTimedMode && <ModalCheckIcon />}
                  </button>
                </div>
              </div>

              {/* Time Per Round (timed mode only) — always rendered, animated */}
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
                    <TimerIcon />
                    <span className="text-[14px] font-bold uppercase tracking-[0.55px] text-[#a3b3ff]">Time Per Round</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {SECONDS_OPTIONS.map((sec) => {
                      const selected = modalDraft.roundDurationSeconds === sec;
                      return (
                        <button
                          key={sec}
                          onClick={() => setModalDraft({ ...modalDraft, roundDurationSeconds: sec })}
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
                    <CategoriesIcon />
                    <span className="text-[14px] font-bold uppercase tracking-[0.55px] text-[#a3b3ff]">Custom Categories</span>
                  </div>
                  <button
                    onClick={() => setModalDraft({ ...modalDraft, categories: [...defaultCategories] })}
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)] transition-colors"
                  >
                    <RestoreIcon />
                    Restore Defaults
                  </button>
                </div>
                <div
                  className="rounded-[14px] p-3 flex flex-col gap-3"
                  style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div className="flex flex-wrap gap-2">
                    {modalDraft.categories.map((cat) => (
                      <span
                        key={cat}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px]"
                        style={{ background: 'rgba(173,70,255,0.2)', border: '1px solid rgba(173,70,255,0.3)' }}
                      >
                        <span className="text-[12px] font-bold text-[#e9d4ff]">{cat}</span>
                        <button
                          onClick={() => handleModalRemoveCategory(cat)}
                          className="flex items-center justify-center text-[rgba(233,212,255,0.5)] hover:text-[#e9d4ff] transition-colors leading-none"
                        >
                          <XSmallIcon />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
                    <input
                      ref={categoryInputRef}
                      value={categoryInput}
                      onChange={(e) => setCategoryInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleModalAddCategory()}
                      placeholder="Add category..."
                      className="flex-1 rounded-[10px] px-3 py-2 text-[14px] font-medium text-white placeholder-[rgba(255,255,255,0.4)] focus:outline-none"
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)' }}
                    />
                    <button
                      onClick={handleModalAddCategory}
                      className="w-[42px] h-[38px] rounded-[10px] flex items-center justify-center flex-shrink-0 transition-colors hover:bg-[rgba(173,70,255,0.3)]"
                      style={{ background: 'rgba(173,70,255,0.2)', border: '1px solid rgba(173,70,255,0.3)' }}
                    >
                      <PlusIcon />
                    </button>
                  </div>
                </div>
              </div>

              {/* Save Changes */}
              <button
                onClick={handleSaveChanges}
                className="w-full h-[60px] rounded-[16px] font-black text-[18px] text-white flex items-center justify-center transition-all"
                style={{
                  background: 'linear-gradient(90deg, #f6339a, #ad46ff)',
                  boxShadow: '0px 4px 20px 0px rgba(236,72,153,0.4)',
                }}
              >
                Save Changes
              </button>
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
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}

function PeopleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2b7fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function SparkleIcon({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0 L9 6 L16 8 L9 10 L8 16 L7 10 L0 8 L7 6 Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(0,201,80,0.9)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CrownIconGold() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
      <path d="M2 20h20M5 20L3 8l5 4 4-8 4 8 5-4-2 12H5z" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,240,133,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );
}

function SmileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function RoundsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2b7fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function TimerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff6900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <polyline points="12 9 12 13 14 15" />
      <line x1="9" y1="3" x2="15" y2="3" />
    </svg>
  );
}

function CategoriesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ad46ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function GameModeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7ccf00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function InfinityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12c-2-2.5-4-4-6-4a4 4 0 000 8c2 0 4-1.5 6-4z" />
      <path d="M12 12c2 2.5 4 4 6 4a4 4 0 000-8c-2 0-4 1.5-6 4z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SettingsIconPink() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f6339a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function XSmallIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ModalCheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e9d4ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

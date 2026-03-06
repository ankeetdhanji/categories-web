import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame, type Player } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api, type GameSettings } from '../services/api';
import { startConnection, joinGameGroup, sendReaction, HubEvents } from '../services/signalr';

const REACTIONS = ['🔥', '👏', '😂', '🎉', '💀'];
const SECONDS_OPTIONS = [30, 60, 90, 120];
const FALLBACK_CATEGORIES = [
  "A boy's name", "A girl's name", "A country", "An animal",
  "A city", "A food", "A TV show", "Something you find at school",
];

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
}

export default function LobbyPage() {
  const {
    gameId, joinCode, playerId, isHost, players, settings,
    setFullSettings, setPlayers, addPlayer,
    setPhase, setCountdownStartAt, setCountdownInfo,
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
  const categoryInputRef = useRef<HTMLInputElement>(null);

  // Init draft once from settings, falling back to defaults if categories are empty.
  // Uses a ref so this only fires once regardless of which dep arrives first.
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
      .catch(console.error);
  }, [gameId, playerId]);

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
          isSpectating: p.isSpectating,
        })),
      );
      // Freshen settings from server (handles case where context was reset)
      if (game.settings) {
        setFullSettings(game.settings);
        setDraft((d) => d ?? game.settings);
      }
    });
  }, [gameId]);

  // Fetch system defaults (cache in localStorage) + host's saved categories
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
          // Only apply non-empty saved categories; empty means "use defaults"
          if (categories.length === 0) return;
          const base = settings ?? draft;
          if (base) applySettingsRef.current?.({ ...base, categories });
        })
        .catch(() => {}); // 404 = no saved prefs, fine
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

  // Stable ref so the saved-cats effect can call applySettings without stale closures
  const applySettingsRef = useRef<((s: GameSettings) => void) | null>(null);

  const applySettings = useCallback(async (newSettings: GameSettings) => {
    setDraft(newSettings);
    setFullSettings(newSettings);
    if (gameId && playerId) {
      api.updateSettings(gameId, playerId, newSettings).catch(console.error);
    }
  }, [gameId, playerId]);

  // Keep ref current so effects can call applySettings without depending on it
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

    // Auto-commit unsaved edits before starting
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

  function handleCategoriesDone() {
    if (!draft) return;
    setEditingCategories(false);
    applySettings(draft);
  }

  function initials(name: string) {
    return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  }

  const AVATAR_COLORS = ['#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];
  function avatarColor(id: string) {
    const hash = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  const s = draft;

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
          <div className="flex items-center gap-2.5">
            <div className="relative w-8 h-8 rounded-[10px] bg-[#161f2b] border border-[#263244] flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-[#3b82f6] to-[#ec4899] opacity-20" />
              <span className="relative font-bold text-[#e5e7eb] text-sm">C</span>
            </div>
            <span className="hidden sm:block font-bold text-[#e5e7eb] text-lg tracking-tight">Categories</span>
          </div>

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

          <div className="flex items-center justify-end">
            <div className="flex items-center gap-1.5 bg-[#161f2b] border border-[#263244] rounded-full px-3 py-1.5">
              <UsersIcon />
              <span className="text-sm font-medium text-[#9ca3af]">{players.length}/{s?.maxPlayers ?? 10}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main — 2-column on md+ */}
      <main className="px-6 py-6 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 pb-36">
        {/* Left: Players card */}
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
                    {p.isSpectating && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[rgba(107,114,128,0.1)] border border-[rgba(107,114,128,0.2)] text-[#6b7280] flex-shrink-0">
                        Spectating
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

        {/* Right: Game Settings card */}
        <div className="bg-[#0b0f14] border border-[#263244] rounded-[16px] p-6 flex flex-col gap-5">
          <h2 className="font-bold text-[#e5e7eb] text-lg tracking-tight">Game Settings</h2>

          {s ? (
            <>
              {/* Mode toggle */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wide">Mode</label>
                <div
                  className="flex bg-[#161f2b] border border-[#263244] rounded-[10px] p-1"
                  style={{ pointerEvents: isHost ? undefined : 'none', opacity: isHost ? 1 : 0.6 }}
                >
                  <button
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-[8px] text-sm font-medium transition-colors"
                    style={{
                      background: s.isTimedMode ? '#263244' : 'transparent',
                      color: s.isTimedMode ? '#e5e7eb' : '#6b7280',
                    }}
                    onClick={() => isHost && applySettings({ ...s, isTimedMode: true })}
                  >
                    <ClockIcon /> Timed
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-[8px] text-sm font-medium transition-colors"
                    style={{
                      background: !s.isTimedMode ? '#263244' : 'transparent',
                      color: !s.isTimedMode ? '#e5e7eb' : '#6b7280',
                    }}
                    onClick={() => isHost && applySettings({ ...s, isTimedMode: false })}
                  >
                    <InfinityIcon /> Relaxed
                  </button>
                </div>
              </div>

              {/* Rounds + Seconds side by side */}
              <div className="flex flex-wrap gap-4 items-start md:justify-between">
                {/* Rounds stepper */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wide">Rounds</label>
                  <div
                    className="flex items-center bg-[#161f2b] border border-[#263244] rounded-[10px] overflow-hidden w-fit"
                    style={{ pointerEvents: isHost ? undefined : 'none', opacity: isHost ? 1 : 0.6 }}
                  >
                    <button
                      className="w-10 h-10 flex items-center justify-center text-[#9ca3af] hover:text-[#e5e7eb] hover:bg-[#263244] transition-colors text-lg font-bold"
                      onClick={() => isHost && s.maxRounds > 1 && applySettings({ ...s, maxRounds: s.maxRounds - 1 })}
                      disabled={!isHost || s.maxRounds <= 1}
                    >
                      −
                    </button>
                    <span className="w-12 text-center font-mono font-bold text-[#e5e7eb] text-base select-none">
                      {s.maxRounds}
                    </span>
                    <button
                      className="w-10 h-10 flex items-center justify-center text-[#9ca3af] hover:text-[#e5e7eb] hover:bg-[#263244] transition-colors text-lg font-bold"
                      onClick={() => isHost && s.maxRounds < 10 && applySettings({ ...s, maxRounds: s.maxRounds + 1 })}
                      disabled={!isHost || s.maxRounds >= 10}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Seconds per round (timed mode only) */}
                {s.isTimedMode && (
                  <div className="flex flex-col gap-2 md:items-end">
                    <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wide">Seconds per Round</label>
                    <div
                      className="relative w-fit"
                      style={{ pointerEvents: isHost ? undefined : 'none', opacity: isHost ? 1 : 0.6 }}
                    >
                      <select
                        value={s.roundDurationSeconds}
                        onChange={(e) => isHost && applySettings({ ...s, roundDurationSeconds: Number(e.target.value) })}
                        disabled={!isHost}
                        className="appearance-none bg-[#161f2b] border border-[#263244] rounded-[10px] px-4 py-2.5 pr-9 text-sm font-medium text-[#e5e7eb] cursor-pointer focus:outline-none focus:border-[#3b82f6]"
                      >
                        {SECONDS_OPTIONS.map((v) => (
                          <option key={v} value={v}>{v}s</option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                        <ChevronDownIcon />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Categories */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[#9ca3af] uppercase tracking-wide">Categories</label>
                  {isHost && !editingCategories && (
                    <button
                      onClick={() => setEditingCategories(true)}
                      className="flex items-center gap-1 text-xs text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
                    >
                      <PencilIcon />
                      EDIT
                    </button>
                  )}
                  {isHost && editingCategories && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setDraft({ ...draft!, categories: [] })}
                        className="text-xs text-[#6b7280] hover:text-[#f87171] transition-colors"
                      >
                        Clear all
                      </button>
                      <button
                        onClick={handleCategoriesDone}
                        className="text-xs font-semibold text-[#10b981] hover:text-[#34d399] transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-[#0b0f14] border border-[#263244] rounded-[10px] p-3 flex flex-wrap gap-2 min-h-[48px]">
                  {s.categories.map((cat) => (
                    <span
                      key={cat}
                      className="flex items-center gap-1 bg-[#161f2b] border border-[rgba(38,50,68,0.5)] rounded-[4px] px-2 py-1 text-xs text-[#e5e7eb]"
                    >
                      {cat}
                      {isHost && editingCategories && (
                        <button
                          onClick={() => handleRemoveCategory(cat)}
                          className="text-[#6b7280] hover:text-[#f87171] transition-colors ml-0.5"
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                </div>

                {isHost && editingCategories && (
                  <>
                    <div className="flex gap-2">
                      <input
                        ref={categoryInputRef}
                        value={categoryInput}
                        onChange={(e) => setCategoryInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                        placeholder="Add a category…"
                        className="flex-1 bg-[#161f2b] border border-[#263244] rounded-[8px] px-3 py-2 text-sm text-[#e5e7eb] placeholder-[#6b7280] focus:outline-none focus:border-[#3b82f6]"
                      />
                      <button
                        onClick={handleAddCategory}
                        className="px-3 py-2 bg-[#161f2b] border border-[#263244] rounded-[8px] text-xs text-[#3b82f6] hover:border-[#3b82f6] transition-colors"
                      >
                        Add
                      </button>
                    </div>

                    {/* Restore defaults + Save as my defaults */}
                    <div className="flex items-center justify-between pt-1">
                      <div>
                        {defaultCategories.length > 0 && categoriesDiffer(draft.categories, defaultCategories) && (
                          <button
                            onClick={() => setDraft({ ...draft, categories: [...defaultCategories] })}
                            className="text-xs text-[#6b7280] hover:text-[#9ca3af] transition-colors"
                          >
                            ↩ Restore defaults
                          </button>
                        )}
                      </div>
                      <button
                        onClick={handleSaveMyDefaults}
                        disabled={draft.categories.length === 0}
                        className="text-xs text-[#3b82f6] hover:text-[#60a5fa] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {saveConfirmed ? '✓ Saved!' : 'Save as my defaults'}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Scoring summary — always read-only */}
              <div className="bg-[rgba(22,31,43,0.5)] border border-[rgba(38,50,68,0.5)] rounded-[10px] px-4 py-3 flex flex-col gap-2 mt-auto">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280] mb-1">Scoring</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9ca3af]">Unique answer</span>
                  <span className="font-mono text-xs text-[#e5e7eb]">{s.uniqueAnswerPoints} pts</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9ca3af]">Shared answer</span>
                  <span className="font-mono text-xs text-[#e5e7eb]">{s.sharedAnswerPoints} pts</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9ca3af]">Best answer</span>
                  <span className="font-mono text-xs text-[#e5e7eb]">{s.bestAnswerBonusPoints} pts</span>
                </div>
                <div className="border-t border-[#263244] pt-2 flex items-center justify-between">
                  <span className="text-xs text-[#9ca3af]">Voting</span>
                  <span className="text-xs text-[#e5e7eb]">{s.disputeVotingWindowSeconds}s · Tie = Valid</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-[#6b7280]">Loading settings…</p>
          )}
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
      <div className="fixed bottom-0 left-0 right-0 z-40 px-6 pt-4 bg-gradient-to-t from-[#0b0f14] to-transparent" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <div className="max-w-5xl mx-auto flex flex-col gap-2">
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
          {startError && (
            <p className="text-center text-xs text-[#f87171]">{startError}</p>
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
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

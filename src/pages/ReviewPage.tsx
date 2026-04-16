import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, X, AlertTriangle, Heart, Flame, Sparkles, CheckCircle2, Crown, ArrowUp, ArrowDown, Trophy, Merge, Ban, Undo2 } from 'lucide-react';
import { useGame, type GamePhase, type RoundInfo } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api, type RoundReviewResult, type AnswerEntry, type LeaderboardEntry, type FinalLeaderboardEntry, type MergeGroup } from '../services/api';
import { HubEvents } from '../services/signalr';
import { useConnectionStatus } from '../hooks/useConnectionStatus';

// Deterministic color per player ID (cycles through a palette)
const AVATAR_COLORS = [
  '#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6',
  '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];
function avatarColor(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) hash = (hash * 31 + playerId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function ReviewPage() {
  const {
    gameId, playerId, isHost,
    players, maxRounds,
    currentRound, reviewRoundNumber, leaderboard,
    setFinalResult, setPhase, setCurrentRound,
    setLeaderboard, setReviewRoundNumber,
    setCountdownStartAt, setCountdownInfo,
  } = useGame();

  // reviewRoundNumber is set by LeaderboardUpdated, which fires after RoundEnded.
  // By the time ReviewPage mounts, RoundPage is already unmounted so that handler
  // may never run. Fall back to currentRound.roundNumber which is always in context.
  const roundToFetch = reviewRoundNumber ?? currentRound?.roundNumber ?? null;

  const [results, setResults] = useState<RoundReviewResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [myLikes, setMyLikes] = useState<Record<string, string>>({}); // category → normalizedAnswer
  const [myDisputeVotes, setMyDisputeVotes] = useState<Record<string, boolean | null>>({}); // disputeId → true/false/null
  const [disputeProgress, setDisputeProgress] = useState<Record<string, { count: number; total: number }>>({});
  const [resolvedDisputes, setResolvedDisputes] = useState<Record<string, boolean>>({}); // disputeId → isValid
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [revealing, setRevealing] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const advancingRef = useRef(false);
  const { isReconnecting } = useConnectionStatus();
  const reconnectingRef = useRef(false);

  // Host moderation state
  const [selectedAnswerKeys, setSelectedAnswerKeys] = useState<Set<string>>(new Set());
  const [rejectedAnswerKeys, setRejectedAnswerKeys] = useState<Set<string>>(new Set());
  const [mergeGroups, setMergeGroups] = useState<MergeGroup[]>([]);
  const [moderationPending, setModerationPending] = useState(false);

  // Reveal animation: flash category name centered, then show answers
  useEffect(() => {
    setRevealing(true);
    setSelectedAnswerKeys(new Set()); // clear selection on category change
    const t = setTimeout(() => setRevealing(false), 1400);
    return () => clearTimeout(t);
  }, [categoryIndex]);

  // Fetch round results on mount
  useEffect(() => {
    if (!gameId || !roundToFetch) return;
    setLoadError(null);
    api.getRoundResults(gameId, roundToFetch)
      .then((r) => {
        setResults(r);
        // Initialize moderation state from persisted data
        const rejected = new Set<string>();
        const mergeGroupsInit: MergeGroup[] = [];
        for (const cat of r.categories) {
          for (const entry of cat.entries) {
            if (entry.isRejected) rejected.add(`${cat.name}:${entry.normalizedAnswer}`);
            if (entry.isMerged && entry.mergeGroupId && !mergeGroupsInit.find(g => g.id === entry.mergeGroupId)) {
              mergeGroupsInit.push({
                id: entry.mergeGroupId,
                category: cat.name,
                canonicalAnswer: entry.mergeCanonicalAnswer ?? entry.rawAnswer,
                mergedNormalizedAnswers: entry.mergeVariants?.map(v => v.trim().toLowerCase()) ?? [],
                players: entry.players,
              });
            }
          }
        }
        setRejectedAnswerKeys(rejected);
        setMergeGroups(mergeGroupsInit);
      })
      .catch((err: unknown) => {
        console.error('getRoundResults failed:', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      });
  // reviewRoundNumber is set by LeaderboardUpdated (~2s after RoundEnded). Re-fetching when it
  // arrives guarantees we read all auto-submitted answers that committed during the grace period.
  }, [gameId, roundToFetch, reviewRoundNumber]);

  // Re-fetch review data on reconnect to restore category index and dispute state
  useEffect(() => {
    const justReconnected = !isReconnecting && reconnectingRef.current;
    reconnectingRef.current = isReconnecting;
    if (!justReconnected || !gameId || !roundToFetch) return;
    setLoadError(null);
    api.getRoundResults(gameId, roundToFetch)
      .then(setResults)
      .catch((err: unknown) => {
        console.error('getRoundResults failed on reconnect:', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      });
  }, [isReconnecting]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback polling — recover from missed SignalR phase-transition events
  const PHASE_POLL_INTERVAL_MS = 5_000;
  useEffect(() => {
    if (!gameId) return;
    const id = setInterval(async () => {
      try {
        const game = await api.getGame(gameId);
        // status 1 = Starting (countdown), 2 = InRound — game has moved to next round
        if ((game.status === 1 || game.status === 2) && game.currentRoundIndex >= 0) {
          const r = game.rounds[game.currentRoundIndex];
          if (r) {
            setCurrentRound({
              roundNumber: r.roundNumber,
              letter: r.letter,
              categories: r.categories,
              startedAt: r.startedAt,
              endsAt: r.endedAt,
            });
            setPhase('answering');
          }
        } else if (game.status === 7) {
          // status 7 = Finished — missed the finalize event
          setPhase('gameOver');
        }
      } catch {
        // swallow — poll errors are non-fatal; next tick will retry
      }
    }, PHASE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Next round auto-started by server — transition back to answering
  useSignalREvent(HubEvents.RoundStarted, (payload) => {
    setCurrentRound(payload as RoundInfo);
    setPhase('answering');
  });

  // SignalR: another client advanced (or this client's own advance was echoed back)
  useSignalREvent(HubEvents.CategoryAdvanced, (data) => {
    const { categoryIndex: nextIdx } = data as { categoryIndex: number };
    advancingRef.current = false;
    setAdvancing(false);
    setCategoryIndex(nextIdx);
  });

  // SignalR: all categories reviewed
  useSignalREvent(HubEvents.ReviewComplete, async () => {
    const isLastRound = (roundToFetch ?? 0) === maxRounds;
    if (isLastRound) {
      setFinalizing(true);
      if (isHost && gameId && playerId) {
        try {
          await api.finalizeGame(gameId, playerId);
          // LeaderboardUpdated (roundNumber=-1) will fire and transition all clients
        } catch {
          setFinalizing(false);
          setShowLeaderboard(true); // fallback: let host retry manually
        }
      }
      // non-hosts just wait for LeaderboardUpdated with roundNumber=-1
    } else {
      setShowLeaderboard(true);
    }
  });

  // SignalR: leaderboard update — either mid-round or final (roundNumber === -1)
  useSignalREvent(HubEvents.LeaderboardUpdated, (data) => {
    const d = data as {
      roundNumber: number;
      leaderboard: (LeaderboardEntry | FinalLeaderboardEntry)[];
      winnerPlayerIds?: string[];
      bonusPerWinner?: number;
    };
    if (d.roundNumber === -1) {
      setFinalResult(d.winnerPlayerIds!, d.bonusPerWinner!, d.leaderboard as FinalLeaderboardEntry[]);
      setPhase('gameOver');
    } else {
      // Mid-game round leaderboard — may arrive after RoundPage has unmounted
      setLeaderboard(d.leaderboard as LeaderboardEntry[]);
      setReviewRoundNumber(d.roundNumber);
    }
  });

  // SignalR: dispute vote progress
  useSignalREvent(HubEvents.DisputeVoteUpdated, (data) => {
    const { disputeId, voteCount, totalVoters } = data as { disputeId: string; voteCount: number; totalVoters: number };
    setDisputeProgress((prev) => ({ ...prev, [disputeId]: { count: voteCount, total: totalVoters } }));
  });

  // SignalR: dispute resolved
  useSignalREvent(HubEvents.DisputeResolved, (data) => {
    const { disputeId, isValid } = data as { disputeId: string; isValid: boolean };
    setResolvedDisputes((prev) => ({ ...prev, [disputeId]: isValid }));
  });

  // SignalR: host rejected/unrejected an answer
  useSignalREvent(HubEvents.AnswerRejected, (data) => {
    const { category, normalizedAnswer, isRejected } = data as { category: string; normalizedAnswer: string; isRejected: boolean };
    const key = `${category}:${normalizedAnswer}`;
    setRejectedAnswerKeys((prev) => {
      const next = new Set(prev);
      if (isRejected) next.add(key); else next.delete(key);
      return next;
    });
  });

  // SignalR: host merged/unmerged answers
  useSignalREvent(HubEvents.AnswerMerged, (data) => {
    const d = data as { isMerged: boolean; mergeGroup?: MergeGroup; mergeGroupId?: string };
    if (d.isMerged && d.mergeGroup) {
      setMergeGroups((prev) => [...prev.filter(g => g.id !== d.mergeGroup!.id), d.mergeGroup!]);
    } else if (!d.isMerged && d.mergeGroupId) {
      setMergeGroups((prev) => prev.filter(g => g.id !== d.mergeGroupId));
    }
  });

  // SignalR: host started next round — show countdown before answering begins
  useSignalREvent(HubEvents.GameCountdown, (data) => {
    const { startAt, letter, roundNumber } = data as { startAt: string; letter: string; roundNumber: number };
    setCountdownStartAt(startAt);
    setCountdownInfo(letter, roundNumber);
    setPhase('countdown');
  });

  // SignalR: host changed — reset advancing state so the new host can advance
  useSignalREvent(HubEvents.HostChanged, () => {
    advancingRef.current = false;
    setAdvancing(false);
  });

  function handleToggleSelect(answerKey: string) {
    setSelectedAnswerKeys((prev) => {
      const next = new Set(prev);
      if (next.has(answerKey)) next.delete(answerKey); else next.add(answerKey);
      return next;
    });
  }

  // Direct reject/unreject from the X button on an individual answer row
  async function handleDirectReject(answerKey: string) {
    if (!gameId || !playerId) return;
    const [category, ...normParts] = answerKey.split(':');
    const normalizedAnswer = normParts.join(':');
    const isCurrentlyRejected = rejectedAnswerKeys.has(answerKey);
    setRejectedAnswerKeys((prev) => {
      const next = new Set(prev);
      if (isCurrentlyRejected) next.delete(answerKey); else next.add(answerKey);
      return next;
    });
    setSelectedAnswerKeys((prev) => { const next = new Set(prev); next.delete(answerKey); return next; });
    try {
      if (isCurrentlyRejected) {
        await api.unrejectAnswer(gameId, playerId, category, normalizedAnswer);
      } else {
        await api.rejectAnswer(gameId, playerId, category, normalizedAnswer);
      }
    } catch {
      setRejectedAnswerKeys((prev) => {
        const next = new Set(prev);
        if (isCurrentlyRejected) next.add(answerKey); else next.delete(answerKey);
        return next;
      });
    }
  }

  // Reject all selected answers from the floating popup
  async function handleRejectSelected() {
    if (!gameId || !playerId) return;
    const keys = [...selectedAnswerKeys];
    setSelectedAnswerKeys(new Set());
    for (const key of keys) {
      const [category, ...normParts] = key.split(':');
      setRejectedAnswerKeys((prev) => { const next = new Set(prev); next.add(key); return next; });
      try {
        await api.rejectAnswer(gameId, playerId, category, normParts.join(':'));
      } catch {
        setRejectedAnswerKeys((prev) => { const next = new Set(prev); next.delete(key); return next; });
      }
    }
  }

  // Merge selected answers — canonical name auto-generated as "Answer1 / Answer2"
  async function handleMerge() {
    if (!gameId || !playerId || !results || selectedAnswerKeys.size < 2) return;
    const keys = [...selectedAnswerKeys];
    const categories = keys.map(k => k.split(':')[0]);
    if (new Set(categories).size !== 1) return;
    const category = categories[0];
    const normalizedAnswers = keys.map(k => k.split(':').slice(1).join(':'));
    const catEntries = results.categories.find(c => c.name === category)?.entries ?? [];
    const uniqueTexts = [...new Set(normalizedAnswers
      .map(norm => catEntries.find(e => e.normalizedAnswer === norm)?.rawAnswer ?? norm))];
    const canonicalAnswer = uniqueTexts.join(' / ');
    setModerationPending(true);
    setSelectedAnswerKeys(new Set());
    try {
      await api.mergeAnswers(gameId, playerId, category, normalizedAnswers, canonicalAnswer);
    } catch {
      setSelectedAnswerKeys(new Set(keys));
    } finally {
      setModerationPending(false);
    }
  }

  async function handleUnmerge(mergeGroupId: string) {
    if (!gameId || !playerId) return;
    setModerationPending(true);
    // Optimistic
    setMergeGroups((prev) => prev.filter(g => g.id !== mergeGroupId));
    try {
      await api.unmergeAnswers(gameId, playerId, mergeGroupId);
    } catch {
      // can't easily revert without re-fetching; silently fail
    } finally {
      setModerationPending(false);
    }
  }

  async function handleAdvance() {
    if (!gameId || !playerId || !results || advancingRef.current) return;
    advancingRef.current = true;
    setAdvancing(true);
    try {
      await api.advanceCategory(gameId, playerId, categoryIndex);
    } catch {
      advancingRef.current = false;
      setAdvancing(false);
    }
  }

  async function handleLike(category: string, normalizedAnswer: string) {
    if (!gameId || !reviewRoundNumber || !playerId) return;
    setMyLikes((prev) => ({ ...prev, [category]: normalizedAnswer }));
    try {
      await api.likeAnswer(gameId, reviewRoundNumber, playerId, category, normalizedAnswer);
    } catch {
      // revert optimistic
      setMyLikes((prev) => {
        const next = { ...prev };
        delete next[category];
        return next;
      });
    }
  }

  async function handleDisputeVote(entry: AnswerEntry, isValid: boolean) {
    if (!gameId || !reviewRoundNumber || !playerId || !entry.disputeId) return;
    if (myDisputeVotes[entry.disputeId] !== undefined) return; // already voted
    setMyDisputeVotes((prev) => ({ ...prev, [entry.disputeId!]: isValid }));
    try {
      await api.castDisputeVote(gameId, reviewRoundNumber, entry.disputeId, playerId, isValid);
    } catch {
      setMyDisputeVotes((prev) => {
        const next = { ...prev };
        delete next[entry.disputeId!];
        return next;
      });
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-screen text-red-400">
        <span className="font-bold text-sm">Failed to load results</span>
        <span className="text-xs font-mono max-w-sm text-center text-gray-400">{loadError}</span>
        <button
          onClick={() => { setLoadError(null); if (gameId && roundToFetch) api.getRoundResults(gameId, roundToFetch).then(setResults).catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e))); }}
          className="mt-2 px-4 py-2 rounded-lg text-xs font-bold text-gray-200"
          style={{ background: 'rgba(30,26,77,0.8)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400">
        Loading results…
      </div>
    );
  }

  const roundNumber = results.roundNumber;
  const letter = results.letter;
  const categories = results.categories;
  const totalCategories = categories.length;
  const currentCategory = categories[Math.min(categoryIndex, totalCategories - 1)];

  // Derive merge groups for current category
  const currentCategoryMergeGroups = mergeGroups.filter(g => g.category === currentCategory.name);
  const mergedNormsInCategory = new Set(currentCategoryMergeGroups.flatMap(g => g.mergedNormalizedAnswers));

  // Non-merged entries
  const regularEntries = currentCategory.entries.filter(e => !e.isMerged && !mergedNormsInCategory.has(e.normalizedAnswer));

  const uniqueCount = regularEntries.filter((e) => e.isUnique && !e.isDisputed && !rejectedAnswerKeys.has(`${currentCategory.name}:${e.normalizedAnswer}`)).length;
  const disputedCount = regularEntries.filter((e) => e.isDisputed).length;

  // Selection mode (host only)
  const isSelectionMode = isHost && selectedAnswerKeys.size > 0;
  const selectedKeys = [...selectedAnswerKeys];
  const selectedCategories = new Set(selectedKeys.map(k => k.split(':')[0]));
  const canMerge = isHost && selectedAnswerKeys.size >= 2 && selectedCategories.size === 1 && selectedCategories.has(currentCategory.name);
  const canReject = isHost && selectedAnswerKeys.size === 1 && selectedCategories.has(currentCategory.name);

  if (finalizing) {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center px-4 gap-4">
        <motion.div
          className="pointer-events-none absolute rounded-full"
          style={{ width: 500, height: 500, top: -100, right: -80, background: '#7c3aed', opacity: 0.25, filter: 'blur(120px)' }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.25, 0.2] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="pointer-events-none absolute rounded-full"
          style={{ width: 500, height: 500, bottom: -100, left: -80, background: '#ec4899', opacity: 0.2, filter: 'blur(120px)' }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.15, 0.2, 0.15] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        />
        <div className="relative z-10 flex flex-col items-center gap-3">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-3 h-3 rounded-full bg-cyan-400 inline-block animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
          <div className="text-white text-xl font-bold">Calculating final scores…</div>
          <div className="text-white/60 text-sm">Get ready for the final results!</div>
        </div>
      </div>
    );
  }

  if (showLeaderboard) {
    return (
      <LeaderboardView
        leaderboard={leaderboard}
        roundNumber={roundNumber}
        maxRounds={maxRounds}
        isHost={isHost}
        gameId={gameId}
        playerId={playerId}
        setFinalResult={setFinalResult}
        setPhase={setPhase}
      />
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden text-gray-200 pb-32">
      {/* Animated background blobs */}
      <motion.div
        className="pointer-events-none absolute rounded-full"
        style={{ width: 500, height: 500, top: -100, right: -80, background: '#7c3aed', opacity: 0.25, filter: 'blur(120px)' }}
        animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.25, 0.2] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute rounded-full"
        style={{ width: 500, height: 500, bottom: -100, left: -80, background: '#1d4ed8', opacity: 0.15, filter: 'blur(120px)' }}
        animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.15, 0.1] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />
      {/* Ambient sparkles */}
      <motion.div
        className="pointer-events-none fixed top-20 left-10 text-yellow-300 opacity-40"
        animate={{ y: [0, -15, 0], scale: [1, 1.2, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Sparkles size={24} />
      </motion.div>
      <motion.div
        className="pointer-events-none fixed top-40 right-12 text-cyan-300 opacity-30"
        animate={{ y: [0, 20, 0], scale: [1, 0.8, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      >
        <Sparkles size={16} />
      </motion.div>

      {/* Sticky header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-6 h-16 bg-black/30 backdrop-blur-xl border-b border-white/10">
        {/* Left: round review pill */}
        <div className="flex items-center gap-2" style={{ flex: '1 0 0' }}>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15">
            <Flame size={14} className="text-cyan-400" />
            <span className="font-bold text-xs text-white tracking-wide">Round {roundNumber} Review</span>
          </div>
          <span className="hidden md:block text-xs text-white/50">
            Round {roundNumber} of {maxRounds}
          </span>
        </div>

        {/* Center: letter badge */}
        <div className="flex justify-center" style={{ flex: '1 0 0' }}>
          <div
            className="flex items-center justify-center rounded-xl font-black text-2xl rotate-3 shrink-0 shadow-lg border border-white/20"
            style={{
              width: 44,
              height: 44,
              background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
              color: '#0b0f14',
              boxShadow: '0 4px 15px rgba(245,158,11,0.4)',
            }}
          >
            {letter}
          </div>
        </div>

        <div style={{ flex: '1 0 0' }} />
      </header>

      {/* Progress dots */}
      <div className="flex gap-2 justify-center py-3 z-10 relative">
        {categories.map((_, i) => {
          if (i < categoryIndex) {
            return <div key={i} className="w-2 h-2 rounded-full bg-white/40" />;
          } else if (i === categoryIndex) {
            return (
              <div
                key={i}
                className="h-2 rounded-full bg-cyan-400"
                style={{ width: 24, boxShadow: '0 0 8px rgba(34,211,238,0.6)' }}
              />
            );
          } else {
            return <div key={i} className="w-2 h-2 rounded-full bg-white/10" />;
          }
        })}
      </div>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col items-center px-4 pt-4 max-w-2xl mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={categoryIndex}
            initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
            transition={{ duration: 0.4 }}
            className="w-full flex-1 flex flex-col justify-center relative"
            style={{ minHeight: 400 }}
          >
            {revealing ? (
              /* Phase 1 — big centered title flash */
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-4">
                <motion.h2
                  layoutId={`cat-name-${categoryIndex}`}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', bounce: 0.6, duration: 0.8 }}
                  className="font-black text-white text-center leading-tight px-4"
                  style={{
                    fontSize: 'clamp(2.5rem, 8vw, 4.5rem)',
                    filter: 'drop-shadow(0 0 40px rgba(34,211,238,0.8))',
                  }}
                >
                  {currentCategory.name}
                </motion.h2>
              </div>
            ) : (
              /* Phase 2 — card slides up */
              <motion.div
                initial={{ opacity: 0, y: 60 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, type: 'spring', bounce: 0 }}
                className="rounded-[2rem] overflow-hidden w-full bg-black/40 backdrop-blur-xl border border-white/10 shadow-[0_15px_40px_rgba(0,0,0,0.4)]"
              >
                {/* Card header */}
                <div
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-5"
                  style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.1), transparent)', borderBottom: '1px solid rgba(255,255,255,0.1)', minHeight: 88 }}
                >
                  <motion.h2
                    layoutId={`cat-name-${categoryIndex}`}
                    className="text-white font-black text-2xl sm:text-3xl tracking-wide"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.8 }}
                  >
                    {currentCategory.name}
                  </motion.h2>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="flex items-center gap-2"
                  >
                    {uniqueCount > 0 && (
                      <span className="text-cyan-400 text-[10px] font-bold px-2.5 py-1 rounded-md flex items-center gap-1 bg-cyan-500/10 border border-cyan-500/20">
                        <CheckCircle2 size={12} /> {uniqueCount} Unique
                      </span>
                    )}
                    {disputedCount > 0 && (
                      <span className="text-orange-400 text-[10px] font-bold px-2.5 py-1 rounded-md flex items-center gap-1 bg-orange-500/10 border border-orange-500/20 animate-pulse">
                        <AlertTriangle size={12} /> {disputedCount} Disputed
                      </span>
                    )}
                  </motion.div>
                </div>

                {/* Answer rows */}
                {currentCategory.entries.length === 0 && currentCategoryMergeGroups.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <span className="text-sm text-white/40">No answers submitted</span>
                  </div>
                ) : (
                  <motion.div
                    variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.1 } } }}
                    initial="hidden"
                    animate="visible"
                    className="p-4 sm:p-6 space-y-3 relative"
                  >
                    {/* Merged answer cards */}
                    <AnimatePresence>
                      {currentCategoryMergeGroups.map((group) => (
                        <motion.div
                          key={`merge-${group.id}`}
                          layoutId={`merge-${group.id}`}
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.7, opacity: 0, y: 20 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.15 }}
                        >
                          <MergedAnswerCard
                            group={group}
                            allEntries={currentCategory.entries}
                            isHost={isHost}
                            onUnmerge={handleUnmerge}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {/* Regular answer rows */}
                    <AnimatePresence>
                      {regularEntries.map((entry, i) => {
                        const answerKey = `${currentCategory.name}:${entry.normalizedAnswer}`;
                        const isRejected = rejectedAnswerKeys.has(answerKey);
                        const isSelected = selectedAnswerKeys.has(answerKey);
                        return (
                          <motion.div
                            key={`${entry.normalizedAnswer}-${i}`}
                            layoutId={answerKey}
                            variants={{ hidden: { opacity: 0, y: 30, scale: 0.95 }, visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 300, damping: 24 } } }}
                            exit={{ scale: 0.7, opacity: 0, y: 20, transition: { duration: 0.25 } }}
                          >
                            <AnswerRow
                              entry={entry}
                              category={currentCategory.name}
                              playerId={playerId}
                              players={players}
                              myLike={myLikes[currentCategory.name]}
                              myVote={entry.disputeId ? myDisputeVotes[entry.disputeId] : undefined}
                              progress={entry.disputeId ? disputeProgress[entry.disputeId] : undefined}
                              resolved={entry.disputeId ? resolvedDisputes[entry.disputeId] : undefined}
                              onLike={handleLike}
                              onDisputeVote={handleDisputeVote}
                              isRejected={isRejected}
                              isSelected={isSelected}
                              isHost={isHost}
                              onToggleSelect={isHost ? () => handleToggleSelect(answerKey) : undefined}
                              onDirectReject={isHost ? () => handleDirectReject(answerKey) : undefined}
                            />
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>

                    {/* Floating action popup — host only, appears when answers are selected */}
                    <AnimatePresence>
                      {isHost && isSelectionMode && (
                        <motion.div
                          initial={{ opacity: 0, y: 12, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 12, scale: 0.95 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                          className="sticky bottom-4 z-20 flex justify-center pt-2"
                        >
                          <div
                            className="flex items-center gap-2 px-4 py-3 rounded-2xl"
                            style={{
                              background: 'rgba(8,15,35,0.95)',
                              backdropFilter: 'blur(16px)',
                              WebkitBackdropFilter: 'blur(16px)',
                              border: '1px solid rgba(96,165,250,0.5)',
                              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                            }}
                          >
                            <button
                              onClick={() => setSelectedAnswerKeys(new Set())}
                              className="p-2 rounded-xl bg-white/10 text-white/60 hover:bg-white/20"
                            >
                              <X size={16} />
                            </button>
                            <span className="text-white/60 text-sm font-semibold pr-1">
                              {selectedAnswerKeys.size} selected
                            </span>
                            {canMerge && (
                              <motion.button
                                whileTap={{ scale: 0.95 }}
                                onClick={handleMerge}
                                disabled={moderationPending}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white font-bold text-sm disabled:opacity-50"
                              >
                                <Merge size={15} /> Merge
                              </motion.button>
                            )}
                            {canReject && (
                              <motion.button
                                whileTap={{ scale: 0.95 }}
                                onClick={handleRejectSelected}
                                disabled={moderationPending}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600/80 text-white font-bold text-sm disabled:opacity-50"
                              >
                                <Ban size={15} /> Reject
                              </motion.button>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Like hint */}
        {!revealing && (
          <div className="flex items-center gap-2 mt-4 opacity-70">
            <Heart size={16} className="text-white/50" />
            <span className="text-sm text-white/50">Pick the best answer for this category (1 vote)</span>
          </div>
        )}
      </main>

      {/* Bottom fade + bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex justify-center">
        <div className="absolute bottom-full left-0 w-full h-32" style={{ background: 'linear-gradient(to top, #0e0b2e, rgba(14,11,46,0.9), transparent)' }} />
        <div
          className="w-full pointer-events-auto backdrop-blur-2xl border-t border-white/10"
          style={{ background: 'rgba(14,11,46,0.9)', boxShadow: '0 -10px 40px rgba(0,0,0,0.5)' }}
        >
          <div className="max-w-2xl mx-auto px-4 pt-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            {isHost ? (
              <div className="flex items-center gap-3">
                <motion.button
                  whileHover={categoryIndex > 0 ? { scale: 1.05 } : {}}
                  whileTap={categoryIndex > 0 ? { scale: 0.95 } : {}}
                  onClick={() => { if (categoryIndex > 0) setCategoryIndex(categoryIndex - 1); }}
                  disabled={categoryIndex === 0}
                  className={`p-4 rounded-2xl flex items-center justify-center transition-all ${
                    categoryIndex === 0
                      ? 'bg-white/5 text-white/20 cursor-not-allowed'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  <ArrowLeft size={24} />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleAdvance}
                  disabled={advancing}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-black text-xl transition-all disabled:opacity-50 relative overflow-hidden group shadow-lg hover:shadow-2xl
                    ${categoryIndex >= totalCategories - 1
                      ? 'bg-gradient-to-r from-pink-500 to-rose-500 border-b-4 border-rose-700 shadow-[0_4px_20px_rgba(244,63,94,0.4)]'
                      : 'bg-gradient-to-r from-cyan-400 to-blue-500 border-b-4 border-blue-700 shadow-[0_4px_20px_rgba(6,182,212,0.4)]'
                    }
                    text-white`}
                >
                  <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  <span className="relative z-10">
                    {advancing ? 'Advancing…' : categoryIndex >= totalCategories - 1 ? 'Finish Review' : 'Next Category'}
                  </span>
                  <ArrowRight size={24} className="relative z-10" />
                </motion.button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-4 w-full">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-2 h-2 rounded-full bg-cyan-400 inline-block animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
                <span className="text-white/70 font-semibold text-lg">Waiting for Host...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Answer row ---

interface AnswerRowProps {
  entry: AnswerEntry;
  category: string;
  playerId: string | null;
  players: { id: string; displayName: string }[];
  myLike: string | undefined;
  myVote: boolean | null | undefined;
  progress: { count: number; total: number } | undefined;
  resolved: boolean | undefined;
  onLike: (category: string, normalizedAnswer: string) => void;
  onDisputeVote: (entry: AnswerEntry, isValid: boolean) => void;
  isRejected?: boolean;
  isSelected?: boolean;
  isHost?: boolean;
  onToggleSelect?: () => void;
  onDirectReject?: () => void;
}

function AnswerRow({ entry, category, playerId, myLike, myVote, progress, resolved, onLike, onDisputeVote, isRejected, isSelected, isHost, onToggleSelect, onDirectReject }: AnswerRowProps) {
  const isOwnAnswer = entry.players.some((p) => p.id === playerId);
  const isAuthor = isOwnAnswer;
  const hasLiked = myLike === entry.normalizedAnswer;
  const hasVoted = myVote !== undefined && myVote !== null;

  // Determine card class + text decoration based on status
  let cardClass = 'rounded-2xl px-4 py-3 flex items-center justify-between transition-all';
  let textDecoration = '';

  if (isRejected) {
    cardClass += ' bg-red-950/30 border border-red-900/50 opacity-50';
    textDecoration = 'line-through';
  } else if (isSelected) {
    cardClass += ' bg-violet-900/30 border border-violet-400 shadow-[0_0_0_2px_rgba(167,139,250,0.3)]';
  } else if (entry.isDisputed && resolved === false) {
    cardClass += ' bg-red-950/30 border border-red-900/50 opacity-70';
    textDecoration = 'line-through';
  } else if (entry.isDisputed && resolved === true) {
    cardClass += ' bg-emerald-950/20 border border-emerald-800/30';
  } else if (entry.isDisputed) {
    cardClass += ' bg-orange-950/40 border border-orange-500/50 shadow-[0_0_15px_rgba(249,115,22,0.15)] relative overflow-hidden';
  } else if (entry.isUnique) {
    cardClass += ' bg-cyan-950/20 border border-cyan-800/30 shadow-[0_2px_10px_rgba(8,145,178,0.1)]';
  } else {
    // shared
    cardClass += ' bg-purple-900/30 border border-purple-500/30 relative overflow-hidden';
  }

  return (
    <div
      className={cardClass}
      style={{ minHeight: 80, cursor: isHost && !isRejected ? 'pointer' : undefined }}
      onClick={isHost && !isRejected && onToggleSelect ? onToggleSelect : undefined}
    >
      {/* Disputed pulse overlay */}
      {entry.isDisputed && resolved === undefined && !isRejected && (
        <div className="absolute inset-0 bg-orange-500/10 animate-pulse pointer-events-none" />
      )}
      {/* Shared right accent bar */}
      {!entry.isDisputed && !entry.isUnique && !isRejected && !isSelected && (
        <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-purple-500/50 pointer-events-none" />
      )}

      {/* Left: answer info */}
      <div className="flex flex-col gap-2 flex-1 min-w-0 relative z-10">
        {/* Answer text + badge */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-bold text-xl text-white" style={{ textDecoration: textDecoration || undefined }}>
            {entry.rawAnswer}
          </span>
          {isRejected && <Badge type="rejected" />}
          {!isRejected && entry.isDisputed && resolved === undefined && <Badge type="disputed" />}
          {!isRejected && entry.isDisputed && resolved === true && <Badge type="valid" />}
          {!isRejected && entry.isDisputed && resolved === false && <Badge type="invalid" />}
          {!isRejected && !entry.isDisputed && entry.isUnique && <Badge type="unique" />}
          {!isRejected && !entry.isDisputed && entry.isShared && <Badge type="shared" />}
        </div>

        {/* Avatar stack + names */}
        <div className="flex items-center gap-2">
          <div className="flex">
            {entry.players.map((p, i) => (
              <div
                key={p.id}
                title={p.displayName}
                className="flex items-center justify-center rounded-full font-bold text-[10px] ring-1 ring-black/30"
                style={{
                  width: 24, height: 24,
                  background: avatarColor(p.id),
                  marginLeft: i > 0 ? -8 : 0,
                  color: '#0b0f14',
                  zIndex: entry.players.length - i,
                  position: 'relative',
                }}
              >
                {p.displayName[0].toUpperCase()}
              </div>
            ))}
          </div>
          <span className="text-xs text-white/40">
            {entry.players.map((p) => p.displayName).join(', ')}
          </span>
        </div>
      </div>

      {/* Right: action area */}
      <div
        className="flex items-center justify-end shrink-0 ml-3 min-w-[130px] md:min-w-[200px] relative z-10 gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {isHost ? (
          isRejected ? (
            <button
              onClick={onDirectReject}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 text-white/60 font-bold text-xs hover:bg-white/20"
            >
              <Undo2 size={14} /> Undo
            </button>
          ) : (
            <button
              onClick={onDirectReject}
              className="p-2 rounded-xl text-white/30 hover:text-red-400 hover:bg-red-900/20 transition-colors"
              title="Reject answer"
            >
              <X size={16} />
            </button>
          )
        ) : entry.isDisputed && !isAuthor ? (
          <DisputeActions
            entry={entry}
            myVote={myVote}
            hasVoted={hasVoted}
            progress={progress}
            resolved={resolved}
            onVote={onDisputeVote}
          />
        ) : entry.isDisputed && isAuthor ? (
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs italic text-white/40">Your answer</span>
            {progress && (
              <span className="text-xs font-mono text-white/40">{progress.count}/{progress.total} voted</span>
            )}
          </div>
        ) : isOwnAnswer ? (
          <span className="text-xs italic text-white/40">Can't vote</span>
        ) : (
          <button
            onClick={() => onLike(category, entry.normalizedAnswer)}
            className="flex items-center justify-center rounded-full transition-all w-11 h-11"
            style={{
              background: hasLiked ? 'rgba(236,72,153,0.15)' : 'rgba(255,255,255,0.08)',
              border: `1px solid ${hasLiked ? '#ec4899' : 'rgba(255,255,255,0.15)'}`,
            }}
            title="Like this answer"
          >
            <Heart size={18} fill={hasLiked ? '#ec4899' : 'none'} color={hasLiked ? '#ec4899' : 'rgba(255,255,255,0.5)'} />
          </button>
        )}
      </div>
    </div>
  );
}

// --- Merged answer card ---

interface MergedAnswerCardProps {
  group: MergeGroup;
  allEntries: AnswerEntry[];
  isHost: boolean;
  onUnmerge: (mergeGroupId: string) => void;
}

function MergedAnswerCard({ group, allEntries, isHost, onUnmerge }: MergedAnswerCardProps) {
  // Derive players from the current results entries rather than trusting the merge group
  // (server's AnswerMerged event doesn't include players)
  const players = allEntries
    .filter(e => group.mergedNormalizedAnswers.includes(e.normalizedAnswer))
    .flatMap(e => e.players)
    .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i);

  return (
    <div
      className="rounded-2xl px-4 py-4 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(109,40,217,0.25) 0%, rgba(76,29,149,0.15) 100%)',
        border: '1.5px solid rgba(139,92,246,0.5)',
        boxShadow: '0 0 20px rgba(109,40,217,0.2)',
      }}
    >
      {/* Duplicate badge */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        {isHost && (
          <button
            onClick={() => onUnmerge(group.id)}
            className="p-1.5 rounded-lg bg-white/10 text-white/50 hover:bg-white/20 mr-1"
            title="Unmerge"
          >
            <Undo2 size={14} />
          </button>
        )}
        <span
          className="inline-flex items-center gap-1 px-2 font-bold text-[10px] rounded-full"
          style={{ height: 20, background: 'rgba(109,40,217,0.3)', border: '1px solid rgba(139,92,246,0.5)', color: '#c084fc', letterSpacing: '0.05em' }}
        >
          <Merge size={10} /> Duplicate
        </span>
      </div>

      {/* Canonical answer */}
      <div className="font-black text-2xl text-white mb-3 pr-24">
        {group.canonicalAnswer}
      </div>

      {/* Player avatars */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex">
          {players.map((p, i) => (
            <div
              key={p.id}
              title={p.displayName}
              className="flex items-center justify-center rounded-full font-bold text-[10px] ring-1 ring-black/30"
              style={{
                width: 24, height: 24,
                background: avatarColor(p.id),
                marginLeft: i > 0 ? -8 : 0,
                color: '#0b0f14',
                zIndex: players.length - i,
                position: 'relative',
              }}
            >
              {p.displayName[0].toUpperCase()}
            </div>
          ))}
        </div>
        <span className="text-xs text-white/50">
          {players.map((p) => p.displayName).join(', ')}
        </span>
      </div>

      {/* Variants */}
      {group.mergedNormalizedAnswers.length > 0 && (
        <div className="text-[11px] italic text-white/35">
          Originally: {group.mergedNormalizedAnswers.join(', ')}
        </div>
      )}
    </div>
  );
}

// --- Dispute voting actions ---

interface DisputeActionsProps {
  entry: AnswerEntry;
  myVote: boolean | null | undefined;
  hasVoted: boolean;
  progress: { count: number; total: number } | undefined;
  resolved: boolean | undefined;
  onVote: (entry: AnswerEntry, isValid: boolean) => void;
}

function DisputeActions({ entry, myVote, hasVoted, progress, resolved, onVote }: DisputeActionsProps) {
  return (
    <div className="flex flex-col items-end gap-1">
      {resolved === undefined ? (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => onVote(entry, true)}
              disabled={hasVoted}
              className="flex items-center gap-1 px-3 rounded-[10px] font-bold text-xs h-[38px] transition-opacity disabled:opacity-50 border border-green-500/30 text-green-400"
              style={{ background: myVote === true ? 'rgba(34,197,94,0.1)' : 'transparent' }}
            >
              <Check size={12} /> Valid
            </button>
            <button
              onClick={() => onVote(entry, false)}
              disabled={hasVoted}
              className="flex items-center gap-1 px-3 rounded-[10px] font-bold text-xs h-[38px] transition-opacity disabled:opacity-50 border border-red-500/30 text-red-400"
              style={{ background: myVote === false ? 'rgba(239,68,68,0.1)' : 'transparent' }}
            >
              <X size={12} /> Invalid
            </button>
          </div>
          <span className="text-[10px] italic text-white/40">Quick vote — anonymous</span>
          {progress && (
            <span className="text-[10px] font-mono text-white/40">{progress.count}/{progress.total} voted</span>
          )}
        </>
      ) : (
        <span className="text-xs font-bold" style={{ color: resolved ? '#22c55e' : '#ef4444' }}>
          {resolved ? '✓ Valid' : '✗ Invalid'}
        </span>
      )}
    </div>
  );
}

// --- Inline leaderboard shown after review complete ---

function LeaderboardView({ leaderboard, roundNumber, maxRounds, isHost, gameId, playerId, setFinalResult, setPhase }: {
  leaderboard: { playerId: string; displayName: string; totalScore: number; roundScore: number }[];
  roundNumber: number;
  maxRounds: number;
  isHost: boolean;
  gameId: string | null;
  playerId: string | null;
  setFinalResult: (winnerIds: string[], bonus: number, finalLeaderboard: import('../services/api').FinalLeaderboardEntry[]) => void;
  setPhase: (phase: GamePhase) => void;
}) {
  const [finalizing, setFinalizing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [animPhase, setAnimPhase] = useState<'initial' | 'reveal_points' | 'tally' | 'reorder' | 'settled'>('initial');
  const isLastRound = roundNumber === maxRounds;

  useEffect(() => {
    const t1 = setTimeout(() => setAnimPhase('reveal_points'), 1200);
    const t2 = setTimeout(() => setAnimPhase('tally'), 2800);
    const t3 = setTimeout(() => setAnimPhase('reorder'), 4000);
    const t4 = setTimeout(() => setAnimPhase('settled'), 5000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, []);

  const enriched = leaderboard.map(e => ({ ...e, prevScore: e.totalScore - e.roundScore }));
  const displayPlayers = [...enriched].sort((a, b) =>
    (animPhase === 'initial' || animPhase === 'reveal_points' || animPhase === 'tally')
      ? b.prevScore - a.prevScore
      : b.totalScore - a.totalScore
  );
  const initialRanking = [...enriched].sort((a, b) => b.prevScore - a.prevScore).map(e => e.playerId);
  const finalRanking = [...enriched].sort((a, b) => b.totalScore - a.totalScore).map(e => e.playerId);

  async function handleFinalize() {
    if (!gameId || !playerId || finalizing) return;
    setFinalizing(true);
    try {
      const result = await api.finalizeGame(gameId, playerId);
      setFinalResult(result.winnerPlayerIds, result.bonusPerWinner, result.leaderboard);
      setPhase('gameOver');
    } catch {
      setFinalizing(false);
    }
  }

  async function handleStartNextRound() {
    if (!gameId || !playerId || starting) return;
    setStarting(true);
    try {
      await api.startNextRound(gameId, playerId);
      // RoundStarted SignalR event will trigger the phase transition for all clients
    } catch {
      setStarting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-900 to-indigo-900 relative overflow-x-hidden overflow-y-auto flex flex-col font-sans pb-32">
      {/* Ambient Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-0 left-0 w-full h-[30vh] bg-gradient-to-b from-indigo-500/20 to-transparent" />
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.15, 0.2, 0.15] }}
          transition={{ duration: 4, repeat: Infinity }}
          className="absolute top-[10%] -right-32 w-[30rem] h-[30rem] bg-purple-600 rounded-full blur-[120px]"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.15, 0.1] }}
          transition={{ duration: 5, repeat: Infinity, delay: 1 }}
          className="absolute bottom-[10%] -left-32 w-[30rem] h-[30rem] bg-pink-600 rounded-full blur-[120px]"
        />
        <motion.div className="absolute top-20 left-10 text-yellow-300 opacity-40"
          animate={{ y: [0, -15, 0], scale: [1, 1.2, 1] }} transition={{ duration: 3, repeat: Infinity }}>
          <Sparkles size={24} />
        </motion.div>
        <motion.div className="absolute top-40 right-12 text-cyan-300 opacity-30"
          animate={{ y: [0, 20, 0], scale: [1, 0.8, 1] }} transition={{ duration: 4, repeat: Infinity, delay: 1 }}>
          <Sparkles size={16} />
        </motion.div>
        <AnimatePresence>
          {animPhase === 'settled' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-yellow-500/20 via-transparent to-transparent pointer-events-none mix-blend-overlay"
            />
          )}
        </AnimatePresence>
      </div>

      <div className="w-full max-w-2xl mx-auto relative z-10 flex flex-col flex-1 mt-6 px-4 md:px-0">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center mb-8"
        >
          <div className="bg-black/30 backdrop-blur-xl rounded-full px-4 py-1.5 flex items-center gap-2 border border-white/10 shadow-lg mb-4">
            <Trophy size={14} className="text-yellow-400" />
            <span className="bg-gradient-to-r from-yellow-400 to-orange-400 text-transparent bg-clip-text text-xs font-black uppercase tracking-widest">
              Round {roundNumber} Results
            </span>
          </div>
          <div className="flex flex-col items-center justify-center text-center">
            <h1 className="text-white font-black text-4xl tracking-tight leading-tight mb-2 drop-shadow-md">
              Leaderboard
            </h1>
            <p className="text-white/60 text-sm font-semibold max-w-xs">
              {animPhase === 'initial' && 'Checking current standings...'}
              {animPhase === 'reveal_points' && 'Adding round points...'}
              {animPhase === 'tally' && 'Tallying new scores...'}
              {(animPhase === 'reorder' || animPhase === 'settled') && 'The final standings!'}
            </p>
          </div>
        </motion.div>

        {/* Player list */}
        <div className="flex flex-col gap-3.5 relative">
          <AnimatePresence>
            {displayPlayers.map((player, index) => {
              const prevRank = initialRanking.indexOf(player.playerId);
              const newRank = finalRanking.indexOf(player.playerId);
              const rankDiff = prevRank - newRank; // positive = moved up
              const isFirstPlace = index === 0;
              const currentDisplayedScore =
                animPhase === 'initial' || animPhase === 'reveal_points'
                  ? player.prevScore
                  : player.totalScore;

              return (
                <motion.div
                  key={player.playerId}
                  layout
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{
                    layout: { type: 'spring', stiffness: 300, damping: 30 },
                    opacity: { duration: 0.3 },
                  }}
                  className={`relative overflow-visible rounded-2xl md:rounded-[1.5rem] border backdrop-blur-xl p-3 md:p-4
                    ${isFirstPlace
                      ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/10 border-yellow-500/40 shadow-[0_0_20px_rgba(234,179,8,0.2)]'
                      : 'bg-black/40 border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)]'
                    }`}
                >
                  {isFirstPlace && (
                    <div className="absolute inset-0 bg-yellow-500/10 animate-pulse rounded-2xl pointer-events-none" />
                  )}
                  <div className="flex items-center justify-between relative z-10">
                    {/* Rank & Identity */}
                    <div className="flex items-center gap-3 md:gap-4">
                      <div className="flex flex-col items-center justify-center w-8">
                        {isFirstPlace ? (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', bounce: 0.6 }}
                            className="text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]"
                          >
                            <Crown size={28} className="fill-yellow-400/20" />
                          </motion.div>
                        ) : (
                          <span className="text-white/40 font-black text-xl">#{index + 1}</span>
                        )}
                      </div>

                      <div
                        className="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-lg md:text-xl font-black text-white shadow-lg ring-2 ring-white/10"
                        style={{ background: avatarColor(player.playerId), color: '#0b0f14' }}
                      >
                        {player.displayName[0].toUpperCase()}
                      </div>

                      <div className="flex flex-col">
                        <span className="text-white font-bold text-lg md:text-xl tracking-wide">
                          {player.displayName}
                        </span>
                        <AnimatePresence>
                          {(animPhase === 'reorder' || animPhase === 'settled') && rankDiff !== 0 && (
                            <motion.div
                              initial={{ opacity: 0, height: 0, marginTop: 0 }}
                              animate={{ opacity: 1, height: 'auto', marginTop: 4 }}
                              className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-wider
                                ${rankDiff > 0 ? 'text-green-400' : 'text-red-400'}`}
                            >
                              {rankDiff > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                              {rankDiff > 0 ? `Up ${rankDiff}` : `Down ${Math.abs(rankDiff)}`}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    {/* Scores */}
                    <div className="flex items-center gap-3">
                      <AnimatePresence>
                        {(animPhase === 'reveal_points' || animPhase === 'tally') && (
                          <motion.div
                            initial={{ opacity: 0, x: -20, scale: 0.5 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, filter: 'blur(5px)' }}
                            transition={{ type: 'spring', bounce: 0.5 }}
                            className="bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-black text-sm md:text-base px-2.5 py-1 rounded-lg shadow-[0_0_15px_rgba(34,211,238,0.3)]"
                          >
                            +{player.roundScore}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="flex flex-col items-end justify-center bg-white/5 border border-white/5 rounded-xl px-4 py-2 min-w-[5rem] text-right shadow-inner">
                        <span className="text-white/40 text-[9px] font-black uppercase tracking-widest mb-0.5">Total</span>
                        <motion.span
                          key={currentDisplayedScore}
                          initial={animPhase === 'tally' ? { scale: 1.5, color: '#4ade80' } : {}}
                          animate={{ scale: 1, color: isFirstPlace ? '#facc15' : '#ffffff' }}
                          transition={{ type: 'spring', bounce: 0.5 }}
                          className={`font-black text-2xl md:text-3xl leading-none
                            ${isFirstPlace ? 'drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]' : ''}`}
                        >
                          {currentDisplayedScore}
                        </motion.span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {leaderboard.length === 0 && (
            <div className="flex items-center justify-center py-12 rounded-2xl bg-white/5 border border-white/10">
              <span className="text-sm text-white/40">No scores yet</span>
            </div>
          )}
        </div>
      </div>

      {/* Floating bottom bar — slides in on reorder/settled */}
      <AnimatePresence>
        {(animPhase === 'reorder' || animPhase === 'settled') && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.6 }}
            className="fixed bottom-0 left-0 w-full z-50 pointer-events-none flex justify-center"
          >
            <div className="absolute bottom-full left-0 w-full h-32 bg-gradient-to-t from-indigo-950 via-indigo-950/90 to-transparent" />
            <div
              className="w-full bg-indigo-950/90 backdrop-blur-2xl border-t border-white/10 px-4 pt-4 pointer-events-auto shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
              <div className="max-w-2xl mx-auto pb-4">
                {isHost ? (
                  isLastRound ? (
                    <motion.button
                      onClick={handleFinalize}
                      disabled={finalizing}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-black text-xl text-white border-b-4 border-rose-700 bg-gradient-to-r from-pink-500 to-rose-500 shadow-[0_8px_30px_rgba(244,63,94,0.4)] disabled:opacity-50 transition-shadow"
                    >
                      {finalizing ? 'Finalizing…' : <><Trophy size={22} /> Finalize Game</>}
                    </motion.button>
                  ) : (
                    <motion.button
                      onClick={handleStartNextRound}
                      disabled={starting}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-black text-xl text-white border-b-4 border-blue-700 bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_8px_30px_rgba(6,182,212,0.4)] disabled:opacity-50 transition-shadow"
                    >
                      {starting ? 'Starting…' : <>Next Round <ArrowRight size={24} /></>}
                    </motion.button>
                  )
                ) : (
                  <div className="flex items-center justify-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-4 w-full">
                    <div className="flex space-x-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 150}ms` }}
                        />
                      ))}
                    </div>
                    <span className="text-white/70 font-semibold text-lg">
                      {isLastRound ? 'Waiting for the host to finalize…' : 'Waiting for Host...'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Badges ---

function Badge({ type }: { type: 'unique' | 'shared' | 'disputed' | 'valid' | 'invalid' | 'rejected' }) {
  const styles: Record<string, { bg: string; border: string; color: string; label: string }> = {
    unique:   { bg: 'rgba(8,145,178,0.2)',   border: 'rgba(34,211,238,0.3)',  color: '#22d3ee', label: 'Unique' },
    shared:   { bg: 'rgba(88,28,135,0.2)',   border: 'rgba(168,85,247,0.3)', color: '#c084fc', label: 'Shared' },
    disputed: { bg: 'rgba(120,53,15,0.2)',   border: 'rgba(245,158,11,0.3)', color: '#fbbf24', label: 'Disputed' },
    valid:    { bg: 'rgba(20,83,45,0.2)',    border: 'rgba(34,197,94,0.3)',  color: '#4ade80', label: 'Valid' },
    invalid:  { bg: 'rgba(127,29,29,0.2)',   border: 'rgba(239,68,68,0.3)',  color: '#f87171', label: 'Invalid' },
    rejected: { bg: 'rgba(127,29,29,0.2)',   border: 'rgba(239,68,68,0.3)',  color: '#f87171', label: 'Rejected' },
  };
  const s = styles[type];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 font-bold text-[10px] rounded-full"
      style={{ height: 20, background: s.bg, border: `1px solid ${s.border}`, color: s.color, letterSpacing: '0.05em' }}
    >
      {type === 'disputed' && <AlertTriangle size={10} />}
      {type === 'unique' && <CheckCircle2 size={10} />}
      {s.label}
    </span>
  );
}

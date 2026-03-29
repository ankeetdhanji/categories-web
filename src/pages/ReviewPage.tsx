import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useGame, type GamePhase, type RoundInfo } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api, type RoundReviewResult, type AnswerEntry, type LeaderboardEntry, type FinalLeaderboardEntry } from '../services/api';
import { HubEvents, sendReaction } from '../services/signalr';
import { useConnectionStatus } from '../hooks/useConnectionStatus';

const CATEGORY_REVIEW_SECONDS = 30;

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
  const [secondsLeft, setSecondsLeft] = useState(CATEGORY_REVIEW_SECONDS);
  const [myLikes, setMyLikes] = useState<Record<string, string>>({}); // category → normalizedAnswer
  const [myDisputeVotes, setMyDisputeVotes] = useState<Record<string, boolean | null>>({}); // disputeId → true/false/null
  const [disputeProgress, setDisputeProgress] = useState<Record<string, { count: number; total: number }>>({});
  const [resolvedDisputes, setResolvedDisputes] = useState<Record<string, boolean>>({}); // disputeId → isValid
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const advancingRef = useRef(false);
  const { isReconnecting } = useConnectionStatus();
  const reconnectingRef = useRef(false);

  // Fetch round results on mount
  useEffect(() => {
    if (!gameId || !roundToFetch) return;
    setLoadError(null);
    api.getRoundResults(gameId, roundToFetch)
      .then(setResults)
      .catch((err: unknown) => {
        console.error('getRoundResults failed:', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      });
  }, [gameId, roundToFetch]);

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

  // Auto-advance timer — only the host calls the advance endpoint when it fires.
  // Use a longer window (45s) when the current category has unresolved disputes.
  const DISPUTE_REVIEW_SECONDS = 45;
  useEffect(() => {
    if (showLeaderboard) return;
    const currentCat = results?.categories[categoryIndex];
    const hasDisputes = currentCat?.entries.some((e) => e.isDisputed) ?? false;
    const duration = hasDisputes ? DISPUTE_REVIEW_SECONDS : CATEGORY_REVIEW_SECONDS;
    setSecondsLeft(duration);
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          if (isHost && !advancingRef.current) handleAdvance();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [categoryIndex, showLeaderboard, isHost, results]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setSecondsLeft(CATEGORY_REVIEW_SECONDS);
  });

  // SignalR: all categories reviewed
  useSignalREvent(HubEvents.ReviewComplete, () => {
    setShowLeaderboard(true);
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

  // SignalR: host started next round — show countdown before answering begins
  useSignalREvent(HubEvents.GameCountdown, (data) => {
    const { startAt, letter, roundNumber } = data as { startAt: string; letter: string; roundNumber: number };
    setCountdownStartAt(startAt);
    setCountdownInfo(letter, roundNumber);
    setPhase('countdown');
  });

  // SignalR: host changed — reset the review timer so the new host can advance
  useSignalREvent(HubEvents.HostChanged, () => {
    advancingRef.current = false;
    setAdvancing(false);
    setSecondsLeft(CATEGORY_REVIEW_SECONDS);
  });

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
      <div
        className="flex flex-col items-center justify-center gap-3 min-h-screen"
        style={{ background: 'linear-gradient(144.77deg, #1e1a4d 0%, #59168b 50%, #312c85 100%)', color: '#ef4444' }}
      >
        <span className="font-bold text-sm">Failed to load results</span>
        <span className="text-xs font-mono max-w-sm text-center" style={{ color: '#9ca3af' }}>{loadError}</span>
        <button
          onClick={() => { setLoadError(null); if (gameId && roundToFetch) api.getRoundResults(gameId, roundToFetch).then(setResults).catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e))); }}
          className="mt-2 px-4 py-2 rounded-lg text-xs font-bold"
          style={{ background: 'rgba(30,26,77,0.8)', border: '1px solid rgba(255,255,255,0.1)', color: '#e5e7eb' }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!results) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{ background: 'linear-gradient(144.77deg, #1e1a4d 0%, #59168b 50%, #312c85 100%)', color: '#9ca3af' }}
      >
        Loading results…
      </div>
    );
  }

  const roundNumber = results.roundNumber;
  const letter = results.letter;
  const categories = results.categories;
  const totalCategories = categories.length;
  const currentCategory = categories[Math.min(categoryIndex, totalCategories - 1)];

  const uniqueCount = currentCategory.entries.filter((e) => e.isUnique && !e.isDisputed).length;
  const disputedCount = currentCategory.entries.filter((e) => e.isDisputed).length;

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
    <div
      className="relative min-h-screen flex flex-col"
      style={{
        background: 'linear-gradient(144.77deg, #1e1a4d 0%, #59168b 50%, #312c85 100%)',
        color: '#e5e7eb',
      }}
    >
      {/* Background blobs */}
      <div
        className="pointer-events-none fixed rounded-full"
        style={{ width: 500, height: 500, top: -100, right: -80, background: '#7c3aed', opacity: 0.25, filter: 'blur(120px)', zIndex: 0 }}
      />
      <div
        className="pointer-events-none fixed rounded-full"
        style={{ width: 500, height: 500, bottom: -100, left: -80, background: '#ec4899', opacity: 0.2, filter: 'blur(120px)', zIndex: 0 }}
      />

      {/* Header */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-6 h-16"
        style={{ background: 'rgba(30,26,77,0.8)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}
      >
        {/* Left: round review pill */}
        <div className="flex items-center gap-2" style={{ flex: '1 0 0' }}>
          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-full"
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            <span style={{ fontSize: 14 }}>🔥</span>
            <span className="font-bold text-xs text-white tracking-wide">Round {roundNumber} Review</span>
          </div>
          <span className="hidden md:block text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Round {roundNumber} of {maxRounds}
          </span>
        </div>

        {/* Center: letter badge */}
        <div className="flex justify-center" style={{ flex: '1 0 0' }}>
          <div
            className="flex items-center justify-center rounded-xl font-black text-2xl rotate-3 shrink-0"
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

        {/* Right: countdown */}
        <div style={{ flex: '1 0 0', display: 'flex', justifyContent: 'flex-end' }}>
          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-sm"
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: secondsLeft <= 10 ? '#ef4444' : '#e5e7eb' }}
          >
            <ClockIcon />
            <span>{secondsLeft}s</span>
          </div>
        </div>
      </header>

      {/* Progress dots */}
      <div className="flex gap-2 justify-center py-3 z-10 relative">
        {categories.map((_, i) => {
          if (i < categoryIndex) {
            return <div key={i} className="rounded-full" style={{ width: 8, height: 8, background: 'rgba(255,255,255,0.4)' }} />;
          } else if (i === categoryIndex) {
            return (
              <div
                key={i}
                className="rounded-full"
                style={{ width: 24, height: 8, background: '#22d3ee', boxShadow: '0 0 8px rgba(34,211,238,0.6)' }}
              />
            );
          } else {
            return <div key={i} className="rounded-full" style={{ width: 8, height: 8, background: 'rgba(255,255,255,0.1)' }} />;
          }
        })}
      </div>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col items-center px-4 pt-4 pb-28 max-w-4xl mx-auto w-full">
        {/* Category name */}
        <AnimatePresence mode="wait">
          <motion.div
            key={categoryIndex}
            initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-2 mb-6 text-center"
          >
            <h2 className="text-4xl md:text-5xl font-black text-white drop-shadow-lg">
              {currentCategory.name}
            </h2>
          </motion.div>
        </AnimatePresence>

        {/* Answers card */}
        <div
          className="w-full rounded-3xl overflow-hidden"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {/* Card header */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
          >
            <span className="font-bold text-sm text-white">{currentCategory.name}</span>
            <div className="flex items-center gap-2">
              {uniqueCount > 0 && (
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.3)', color: '#22d3ee' }}
                >
                  {uniqueCount} Unique
                </span>
              )}
              {disputedCount > 0 && (
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}
                >
                  {disputedCount} Disputed
                </span>
              )}
            </div>
          </div>

          {/* Answer rows */}
          {currentCategory.entries.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No answers submitted</span>
            </div>
          ) : (
            currentCategory.entries.map((entry, i) => (
              <AnswerRow
                key={`${entry.normalizedAnswer}-${i}`}
                entry={entry}
                category={currentCategory.name}
                playerId={playerId}
                players={players}
                myLike={myLikes[currentCategory.name]}
                myVote={entry.disputeId ? myDisputeVotes[entry.disputeId] : undefined}
                progress={entry.disputeId ? disputeProgress[entry.disputeId] : undefined}
                resolved={entry.disputeId ? resolvedDisputes[entry.disputeId] : undefined}
                isLast={i === currentCategory.entries.length - 1}
                onLike={handleLike}
                onDisputeVote={handleDisputeVote}
              />
            ))
          )}
        </div>

        {/* Like hint */}
        <div className="flex items-center gap-2 mt-4 opacity-80">
          <HeartIcon filled={false} color="rgba(255,255,255,0.5)" size={16} />
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Pick the best answer for this category (1 vote)</span>
        </div>
      </main>

      {/* Bottom bar */}
      <footer
        className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-between px-4 md:px-6 py-3"
        style={{
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          background: 'rgba(17,6,60,0.8)',
          backdropFilter: 'blur(24px)',
          borderTop: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {/* Emoji reaction button */}
        <button
          onClick={() => sendReaction(gameId ?? '', '🔥')}
          className="flex items-center justify-center rounded-full shrink-0 transition-transform hover:scale-110"
          style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}
        >
          <span style={{ fontSize: 20 }}>😊</span>
        </button>

        {/* Center: host actions / waiting */}
        {isHost ? (
          <div className="flex items-center gap-2">
            {/* Prev arrow */}
            <button
              onClick={() => {
                if (categoryIndex > 0) setCategoryIndex(categoryIndex - 1);
              }}
              disabled={categoryIndex === 0}
              className="flex items-center justify-center rounded-xl font-bold text-sm transition-all disabled:opacity-30"
              style={{
                width: 40,
                height: 40,
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#e5e7eb',
              }}
              title="Previous category"
            >
              <ChevronLeftIcon />
            </button>
            <button
              onClick={handleAdvance}
              disabled={advancing}
              className="flex items-center gap-2 px-5 rounded-xl font-bold text-sm transition-all disabled:opacity-50"
              style={{
                height: 42,
                background: 'linear-gradient(135deg, #22d3ee 0%, #3b82f6 100%)',
                color: '#0b0f14',
                boxShadow: '0 4px 15px rgba(34,211,238,0.3)',
              }}
            >
              <span>{categoryIndex >= totalCategories - 1 ? 'Finish Review' : 'Next Category'}</span>
              <SkipForwardIcon />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <span className="text-sm font-medium">Waiting for Host</span>
            <BouncingDots />
          </div>
        )}

        {/* Right: spacer to balance layout */}
        <div style={{ width: 40 }} />
      </footer>
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
  isLast: boolean;
  onLike: (category: string, normalizedAnswer: string) => void;
  onDisputeVote: (entry: AnswerEntry, isValid: boolean) => void;
}

function AnswerRow({ entry, category, playerId, myLike, myVote, progress, resolved, isLast, onLike, onDisputeVote }: AnswerRowProps) {
  const isOwnAnswer = entry.players.some((p) => p.id === playerId);
  const isAuthor = isOwnAnswer; // author cannot vote on their own dispute
  const hasLiked = myLike === entry.normalizedAnswer;
  const hasVoted = myVote !== undefined && myVote !== null;

  // Determine row styling
  let rowStyle: React.CSSProperties = {
    borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.06)',
  };
  let textStyle: React.CSSProperties = {};

  if (entry.isDisputed && resolved === false) {
    // Invalid
    rowStyle = {
      ...rowStyle,
      background: 'rgba(127,29,29,0.2)',
      borderLeft: '4px solid #dc2626',
      opacity: 0.7,
    };
    textStyle = { textDecoration: 'line-through' };
  } else if (entry.isDisputed && resolved === true) {
    // Valid (resolved)
    rowStyle = {
      ...rowStyle,
      background: 'rgba(20,83,45,0.2)',
      borderLeft: '4px solid #22c55e',
    };
  } else if (entry.isDisputed) {
    // Still being disputed
    rowStyle = {
      ...rowStyle,
      background: 'rgba(67,20,7,0.3)',
      borderLeft: '4px solid #f97316',
      animation: 'disputePulse 2s ease-in-out infinite',
    };
  } else if (entry.isUnique) {
    // Unique
    rowStyle = {
      ...rowStyle,
      background: 'rgba(8,51,68,0.2)',
      borderLeft: '4px solid #06b6d4',
    };
  } else {
    // Shared/duplicate
    rowStyle = {
      ...rowStyle,
      background: 'rgba(59,7,100,0.2)',
      borderLeft: '4px solid rgba(168,85,247,0.4)',
    };
  }

  return (
    <div
      className="flex items-center justify-between px-5 py-4"
      style={{ minHeight: 90, ...rowStyle }}
    >
      {/* Left: answer info */}
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {/* Answer text + badge */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-bold text-xl text-white" style={textStyle}>
            {entry.rawAnswer}
          </span>
          {entry.isDisputed && resolved === undefined && (
            <Badge type="disputed" />
          )}
          {entry.isDisputed && resolved === true && (
            <Badge type="valid" />
          )}
          {entry.isDisputed && resolved === false && (
            <Badge type="invalid" />
          )}
          {!entry.isDisputed && entry.isUnique && <Badge type="unique" />}
          {!entry.isDisputed && entry.isShared && <Badge type="shared" />}
        </div>

        {/* Avatar stack + names */}
        <div className="flex items-center gap-2">
          <div className="flex">
            {entry.players.map((p, i) => (
              <div
                key={p.id}
                title={p.displayName}
                className="flex items-center justify-center rounded-full font-bold text-[10px]"
                style={{
                  width: 24, height: 24,
                  background: avatarColor(p.id),
                  border: '1px solid rgba(0,0,0,0.3)',
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
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {entry.players.map((p) => p.displayName).join(', ')}
          </span>
        </div>
      </div>

      {/* Right: action area */}
      <div className="flex items-center justify-end shrink-0 ml-3 min-w-[130px] md:min-w-[200px]">
        {entry.isDisputed && !isAuthor ? (
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
            <span className="text-xs italic" style={{ color: 'rgba(255,255,255,0.4)' }}>Your answer</span>
            {progress && (
              <span className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{progress.count}/{progress.total} voted</span>
            )}
          </div>
        ) : isOwnAnswer ? (
          <span className="text-xs italic" style={{ color: 'rgba(255,255,255,0.4)' }}>Can't vote</span>
        ) : (
          <button
            onClick={() => onLike(category, entry.normalizedAnswer)}
            className="flex items-center justify-center rounded-full transition-all"
            style={{
              width: 44, height: 44,
              background: hasLiked ? 'rgba(236,72,153,0.15)' : 'rgba(255,255,255,0.08)',
              border: `1px solid ${hasLiked ? '#ec4899' : 'rgba(255,255,255,0.15)'}`,
            }}
            title="Like this answer"
          >
            <HeartIcon filled={hasLiked} color={hasLiked ? '#ec4899' : 'rgba(255,255,255,0.5)'} size={18} />
          </button>
        )}
      </div>
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
              className="flex items-center gap-1 px-3 rounded-[10px] font-bold text-xs transition-opacity disabled:opacity-50"
              style={{
                height: 38,
                border: '1px solid rgba(34,197,94,0.3)',
                color: '#22c55e',
                background: myVote === true ? 'rgba(34,197,94,0.1)' : 'transparent',
              }}
            >
              <CheckIcon /> Valid
            </button>
            <button
              onClick={() => onVote(entry, false)}
              disabled={hasVoted}
              className="flex items-center gap-1 px-3 rounded-[10px] font-bold text-xs transition-opacity disabled:opacity-50"
              style={{
                height: 38,
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#ef4444',
                background: myVote === false ? 'rgba(239,68,68,0.1)' : 'transparent',
              }}
            >
              <XIcon /> Invalid
            </button>
          </div>
          <span className="text-[10px] italic" style={{ color: 'rgba(255,255,255,0.4)' }}>Quick vote — anonymous</span>
          {progress && (
            <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{progress.count}/{progress.total} voted</span>
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
  const isLastRound = roundNumber === maxRounds;

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
    <div
      className="relative min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: 'linear-gradient(144.77deg, #1e1a4d 0%, #59168b 50%, #312c85 100%)' }}
    >
      {/* Background blobs */}
      <div
        className="pointer-events-none fixed rounded-full"
        style={{ width: 500, height: 500, top: -100, right: -80, background: '#7c3aed', opacity: 0.25, filter: 'blur(120px)' }}
      />
      <div
        className="pointer-events-none fixed rounded-full"
        style={{ width: 500, height: 500, bottom: -100, left: -80, background: '#ec4899', opacity: 0.2, filter: 'blur(120px)' }}
      />

      <div className="relative z-10 w-full max-w-lg flex flex-col gap-6">
        {/* Header section */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="flex items-center gap-2 px-4 py-1.5 rounded-full font-bold text-sm"
            style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(249,115,22,0.2) 100%)', border: '1px solid rgba(245,158,11,0.3)', color: '#fbbf24' }}
          >
            <span>🏆</span>
            <span>Round {roundNumber} Results</span>
          </div>
          <h2 className="font-bold text-4xl tracking-tight text-white" style={{ letterSpacing: '-0.7px' }}>
            Leaderboard
          </h2>
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Round {roundNumber} of {maxRounds}</span>
        </div>

        {/* Player list */}
        <div className="flex flex-col">
          {leaderboard.map((entry, i) => (
            <motion.div
              key={entry.playerId}
              layout
              className="flex items-center gap-4 px-4 py-3 rounded-2xl mb-2"
              style={
                i === 0
                  ? { background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)' }
                  : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }
              }
            >
              <span className="font-bold text-lg w-6 text-center" style={{ color: i === 0 ? '#f59e0b' : 'rgba(255,255,255,0.4)' }}>
                {i + 1}
              </span>
              <div
                className="flex items-center justify-center rounded-full font-bold text-xs shrink-0"
                style={{ width: 32, height: 32, background: avatarColor(entry.playerId), color: '#0b0f14' }}
              >
                {entry.displayName[0].toUpperCase()}
              </div>
              <span className="flex-1 font-semibold text-white">{entry.displayName}</span>
              <div className="flex flex-col items-end gap-1">
                <span className="font-bold text-base text-white">{entry.totalScore}</span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-bold"
                  style={{ background: 'rgba(34,211,238,0.2)', border: '1px solid rgba(34,211,238,0.3)', color: '#67e8f9' }}
                >
                  +{entry.roundScore} pts
                </span>
              </div>
            </motion.div>
          ))}
          {leaderboard.length === 0 && (
            <div className="flex items-center justify-center py-8 rounded-2xl" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No scores yet</span>
            </div>
          )}
        </div>

        {/* Bottom bar — host buttons */}
        {isHost && isLastRound ? (
          <button
            onClick={handleFinalize}
            disabled={finalizing}
            className="w-full h-14 rounded-[14px] font-bold text-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)',
              color: '#fff',
              boxShadow: '0 0 20px rgba(236,72,153,0.4)',
            }}
          >
            {finalizing ? 'Finalizing…' : '🏆 Finalize Game'}
          </button>
        ) : isHost ? (
          <button
            onClick={handleStartNextRound}
            disabled={starting}
            className="w-full h-14 rounded-[14px] font-bold text-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #22d3ee 0%, #3b82f6 100%)',
              color: '#0b0f14',
              boxShadow: '0 0 20px rgba(34,211,238,0.3)',
            }}
          >
            {starting ? 'Starting…' : 'Start Next Round →'}
          </button>
        ) : (
          <div className="flex flex-col items-center gap-2">
            {isLastRound
              ? <p className="text-center text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Waiting for the host to finalize the game…</p>
              : <p className="text-center text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Waiting for host...</p>
            }
          </div>
        )}
      </div>
    </div>
  );
}

// --- Badges ---

function Badge({ type }: { type: 'unique' | 'shared' | 'disputed' | 'valid' | 'invalid' }) {
  const styles: Record<string, { bg: string; border: string; color: string; label: string }> = {
    unique:   { bg: 'rgba(8,145,178,0.2)',   border: 'rgba(34,211,238,0.3)',  color: '#22d3ee', label: 'Unique' },
    shared:   { bg: 'rgba(88,28,135,0.2)',   border: 'rgba(168,85,247,0.3)', color: '#c084fc', label: 'Shared' },
    disputed: { bg: 'rgba(120,53,15,0.2)',   border: 'rgba(245,158,11,0.3)', color: '#fbbf24', label: 'Disputed' },
    valid:    { bg: 'rgba(20,83,45,0.2)',    border: 'rgba(34,197,94,0.3)',  color: '#4ade80', label: 'Valid' },
    invalid:  { bg: 'rgba(127,29,29,0.2)',   border: 'rgba(239,68,68,0.3)',  color: '#f87171', label: 'Invalid' },
  };
  const s = styles[type];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 font-bold text-[10px] rounded-full"
      style={{ height: 20, background: s.bg, border: `1px solid ${s.border}`, color: s.color, letterSpacing: '0.05em' }}
    >
      {type === 'disputed' && <AlertTriangleIcon />}
      {type === 'unique' && <span>✓</span>}
      {s.label}
    </span>
  );
}

// --- Bouncing dots animation ---

function BouncingDots() {
  return (
    <span className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="rounded-full"
          style={{
            width: 4,
            height: 4,
            background: 'rgba(255,255,255,0.5)',
            display: 'inline-block',
            animation: `bounceDot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes bounceDot {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
        @keyframes disputePulse {
          0%, 100% { background-color: rgba(67,20,7,0.3); }
          50% { background-color: rgba(120,53,15,0.3); }
        }
      `}</style>
    </span>
  );
}

// --- Icons ---

function HeartIcon({ filled, color, size }: { filled: boolean; color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

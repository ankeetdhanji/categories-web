import { useEffect, useRef, useState } from 'react';
import { useGame, type GamePhase, type RoundInfo } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api, type RoundReviewResult, type AnswerEntry, type LeaderboardEntry, type FinalLeaderboardEntry } from '../services/api';
import { HubEvents, sendReaction } from '../services/signalr';

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

  // Auto-advance timer — only the host calls the advance endpoint when it fires
  useEffect(() => {
    if (showLeaderboard) return;
    setSecondsLeft(CATEGORY_REVIEW_SECONDS);
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
  }, [categoryIndex, showLeaderboard, isHost]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="flex flex-col items-center justify-center gap-3 min-h-screen" style={{ background: '#0b0f14', color: '#ef4444' }}>
        <span className="font-bold text-sm">Failed to load results</span>
        <span className="text-xs font-mono max-w-sm text-center" style={{ color: '#9ca3af' }}>{loadError}</span>
        <button
          onClick={() => { setLoadError(null); if (gameId && roundToFetch) api.getRoundResults(gameId, roundToFetch).then(setResults).catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e))); }}
          className="mt-2 px-4 py-2 rounded-lg text-xs font-bold"
          style={{ background: '#161f2b', border: '1px solid #263244', color: '#e5e7eb' }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: '#0b0f14', color: '#9ca3af' }}>
        Loading results…
      </div>
    );
  }

  const roundNumber = results.roundNumber;
  const letter = results.letter;
  const categories = results.categories;
  const totalCategories = categories.length;
  const currentCategory = categories[Math.min(categoryIndex, totalCategories - 1)];

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

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
    <div className="relative min-h-screen flex flex-col" style={{ background: '#0b0f14', color: '#e5e7eb' }}>
      {/* Background glows */}
      <div className="pointer-events-none absolute rounded-full" style={{ width: 600, height: 600, top: -94, right: -90, background: '#3b82f6', opacity: 0.05, filter: 'blur(120px)' }} />
      <div className="pointer-events-none absolute rounded-full" style={{ width: 1084, height: 300, top: 94, left: 0, background: '#3b82f6', opacity: 0.03, filter: 'blur(100px)' }} />

      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-6 h-20" style={{ background: 'rgba(11,15,20,0.9)', borderBottom: '1px solid #263244' }}>
        {/* Left: logo + round info */}
        <div className="flex items-center gap-4" style={{ flex: '1 0 0' }}>
          <div className="flex items-center justify-center rounded-[10px] shrink-0" style={{ width: 32, height: 32, background: '#161f2b', border: '1px solid #263244' }}>
            <span className="font-bold text-sm" style={{ color: '#e5e7eb' }}>LD</span>
          </div>
          <span className="font-bold text-xs tracking-widest uppercase" style={{ color: '#9ca3af' }}>
            Round {roundNumber} of {maxRounds}
          </span>
        </div>

        {/* Center: phase pill */}
        <div className="hidden md:flex" style={{ flex: '1 0 0', justifyContent: 'center' }}>
          <div className="flex items-center gap-2 px-3 rounded-full" style={{ height: 29, background: '#161f2b', border: '1px solid #263244' }}>
            <div className="rounded-full shrink-0" style={{ width: 6, height: 6, background: '#3b82f6', opacity: 0.51 }} />
            <span className="font-bold text-xs tracking-wide" style={{ color: '#e5e7eb' }}>Review answers</span>
          </div>
        </div>

        {/* Right: countdown */}
        <div style={{ flex: '1 0 0', display: 'flex', justifyContent: 'flex-end' }}>
          <div className="flex flex-col items-end">
            <span className="font-medium text-sm" style={{ color: '#f59e0b' }}>Next category in</span>
            <span className="font-bold font-mono text-lg" style={{ color: '#f59e0b' }}>{mm}:{ss}</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center px-4 pt-8 pb-24 max-w-4xl mx-auto w-full">
        {/* Category header */}
        <div className="flex flex-col items-center gap-4 mb-6">
          <span className="font-bold text-xs tracking-widest uppercase" style={{ color: '#9ca3af' }}>
            Category {categoryIndex + 1} of {totalCategories}
          </span>
          <div className="flex items-center gap-3">
            <h2 className="font-bold text-3xl md:text-5xl tracking-tight" style={{ color: '#e5e7eb', letterSpacing: '-0.85px' }}>
              {currentCategory.name}
            </h2>
            <div className="rotate-3 shrink-0">
              <div className="flex items-center justify-center rounded-[14px]" style={{ width: 48, height: 48, background: '#161f2b', border: '1px solid #263244', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                <span className="font-bold text-2xl" style={{ color: '#e5e7eb' }}>{letter}</span>
              </div>
            </div>
          </div>
          <span className="text-sm" style={{ color: '#6b7280' }}>Review and vote if needed</span>
        </div>

        {/* Answers card */}
        <div className="w-full rounded-2xl overflow-hidden" style={{ background: '#111827', border: '1px solid #263244', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
          {/* Card header */}
          <div className="flex items-center justify-between px-6" style={{ height: 54, background: 'rgba(22,31,43,0.5)', borderBottom: '1px solid #263244' }}>
            <span className="font-bold text-sm tracking-widest uppercase" style={{ color: '#e5e7eb' }}>Answers</span>
            <div className="px-2 rounded" style={{ background: '#161f2b', border: '1px solid #263244' }}>
              <span className="text-xs" style={{ color: '#9ca3af', lineHeight: '21px' }}>{currentCategory.entries.length} submission{currentCategory.entries.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Answer rows */}
          {currentCategory.entries.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm" style={{ color: '#6b7280' }}>No answers submitted</span>
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
          <HeartIcon filled={false} color="#9ca3af" size={16} />
          <span className="text-sm" style={{ color: '#9ca3af' }}>Pick the best answer for this category (1 vote)</span>
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-between px-4 md:px-6 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))', background: 'rgba(11,15,20,0.9)', borderTop: '1px solid #263244' }}>
        {/* Emoji button */}
        <button
          onClick={() => sendReaction(gameId ?? '', '🔥')}
          className="flex items-center justify-center rounded-full shrink-0"
          style={{ width: 40, height: 40, background: '#161f2b', border: '1px solid #263244' }}
        >
          <span style={{ fontSize: 20 }}>😊</span>
        </button>

        {/* Auto-advance label */}
        <div className="flex items-center gap-2">
          <ClockIcon />
          <span className="font-mono font-bold text-sm" style={{ color: '#e5e7eb' }}>Auto-advance in {secondsLeft}s</span>
        </div>

        {/* Next category button (host only) */}
        {isHost && (
          <button
            onClick={handleAdvance}
            disabled={advancing}
            className="flex items-center gap-2 px-4 rounded-[10px] font-bold text-sm transition-opacity disabled:opacity-50"
            style={{ height: 42, border: '1px solid rgba(59,130,246,0.3)', color: '#3b82f6' }}
          >
            <span>Next category</span>
            <SkipForwardIcon />
          </button>
        )}
        {!isHost && <div className="w-[100px] md:w-[155px]" />}
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

  const rowBg = entry.isDisputed ? 'rgba(245,158,11,0.05)' : 'transparent';

  return (
    <div
      className="flex items-center justify-between px-4 md:px-6"
      style={{
        minHeight: 109,
        background: rowBg,
        borderBottom: isLast ? 'none' : '1px solid #263244',
      }}
    >
      {/* Left: answer info */}
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {/* Answer text + badge */}
        <div className="flex items-center gap-3">
          <span className="font-semibold text-xl" style={{ color: '#e5e7eb', letterSpacing: '-0.45px' }}>
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
                  border: '1px solid #161f2b',
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
          <span className="text-xs" style={{ color: '#6b7280' }}>
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
            <span className="text-xs italic" style={{ color: '#6b7280' }}>Your answer</span>
            {progress && (
              <span className="text-xs font-mono" style={{ color: '#6b7280' }}>{progress.count}/{progress.total} voted</span>
            )}
          </div>
        ) : isOwnAnswer ? (
          <span className="text-xs italic" style={{ color: '#6b7280' }}>Can't vote</span>
        ) : (
          <button
            onClick={() => onLike(category, entry.normalizedAnswer)}
            className="flex items-center justify-center rounded-full transition-all"
            style={{
              width: 44, height: 44,
              background: hasLiked ? 'rgba(236,72,153,0.15)' : '#161f2b',
              border: `1px solid ${hasLiked ? '#ec4899' : '#263244'}`,
            }}
            title="Like this answer"
          >
            <HeartIcon filled={hasLiked} color={hasLiked ? '#ec4899' : '#9ca3af'} size={18} />
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
          <span className="text-[10px] italic" style={{ color: '#6b7280' }}>Quick vote — anonymous</span>
          {progress && (
            <span className="text-[10px] font-mono" style={{ color: '#6b7280' }}>{progress.count}/{progress.total} voted</span>
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
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: '#0b0f14' }}>
      <div className="pointer-events-none absolute rounded-full" style={{ width: 600, height: 600, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#3b82f6', opacity: 0.05, filter: 'blur(120px)' }} />

      <div className="relative z-10 w-full max-w-lg flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <span className="font-bold text-xs tracking-widest uppercase" style={{ color: '#9ca3af' }}>Round {roundNumber} of {maxRounds}</span>
          <h2 className="font-bold text-4xl tracking-tight" style={{ color: '#e5e7eb', letterSpacing: '-0.7px' }}>Leaderboard</h2>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: '#111827', border: '1px solid #263244' }}>
          {leaderboard.map((entry, i) => (
            <div
              key={entry.playerId}
              className="flex items-center gap-4 px-6"
              style={{ height: 64, borderBottom: i < leaderboard.length - 1 ? '1px solid #263244' : 'none' }}
            >
              <span className="font-bold text-lg w-6 text-center" style={{ color: i === 0 ? '#f59e0b' : '#6b7280' }}>
                {i + 1}
              </span>
              <div className="flex items-center justify-center rounded-full font-bold text-xs shrink-0" style={{ width: 32, height: 32, background: avatarColor(entry.playerId), color: '#0b0f14' }}>
                {entry.displayName[0].toUpperCase()}
              </div>
              <span className="flex-1 font-semibold" style={{ color: '#e5e7eb' }}>{entry.displayName}</span>
              <div className="flex flex-col items-end">
                <span className="font-bold text-base" style={{ color: '#e5e7eb' }}>{entry.totalScore}</span>
                <span className="text-xs" style={{ color: entry.roundScore > 0 ? '#22c55e' : '#6b7280' }}>
                  +{entry.roundScore} this round
                </span>
              </div>
            </div>
          ))}
          {leaderboard.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <span className="text-sm" style={{ color: '#6b7280' }}>No scores yet</span>
            </div>
          )}
        </div>

        {isHost && isLastRound ? (
          <button
            onClick={handleFinalize}
            disabled={finalizing}
            className="w-full h-14 rounded-[14px] font-bold text-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            style={{ background: '#ec4899', color: '#0b0f14', boxShadow: '0 0 20px rgba(236,72,153,0.3)' }}
          >
            {finalizing ? 'Finalizing…' : '🏆 Finalize Game'}
          </button>
        ) : isHost ? (
          <button
            onClick={handleStartNextRound}
            disabled={starting}
            className="w-full h-14 rounded-[14px] font-bold text-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            style={{ background: '#3b82f6', color: '#0b0f14', boxShadow: '0 0 20px rgba(59,130,246,0.3)' }}
          >
            {starting ? 'Starting…' : 'Start Next Round →'}
          </button>
        ) : (
          <p className="text-center text-sm" style={{ color: '#6b7280' }}>Waiting for the host to start the next round…</p>
        )}
        {!isHost && isLastRound && (
          <p className="text-center text-sm" style={{ color: '#6b7280' }}>Waiting for the host to finalize the game…</p>
        )}
      </div>
    </div>
  );
}

// --- Badges ---

function Badge({ type }: { type: 'unique' | 'shared' | 'disputed' | 'valid' | 'invalid' }) {
  const styles: Record<string, { bg: string; border: string; color: string; label: string }> = {
    unique:   { bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.2)',  color: '#3b82f6', label: 'UNIQUE' },
    shared:   { bg: '#161f2b',               border: '#263244',               color: '#9ca3af', label: 'SHARED' },
    disputed: { bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.2)',  color: '#f59e0b', label: 'DISPUTED' },
    valid:    { bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.2)',   color: '#22c55e', label: 'VALID' },
    invalid:  { bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.2)',   color: '#ef4444', label: 'INVALID' },
  };
  const s = styles[type];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 font-bold text-[10px] rounded"
      style={{ height: 21, background: s.bg, border: `1px solid ${s.border}`, color: s.color, letterSpacing: '0.12px' }}
    >
      {type === 'disputed' && <AlertTriangleIcon />}
      {s.label}
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

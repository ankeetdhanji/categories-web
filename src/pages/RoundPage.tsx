import { useEffect, useRef, useState } from 'react';
import { useGame, type RoundInfo } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api } from '../services/api';
import { sendReaction, notifyAnswerPresence, HubEvents } from '../services/signalr';

const REACTIONS = ['🔥', '😂', '😎', '🤔', '👏', '✨'];

export default function RoundPage() {
  const {
    gameId, playerId, isHost, phase, currentRound,
    countdownStartAt, countdownLetter, countdownRoundNumber,
    players, isTimedMode, maxRounds,
    setPhase, setCurrentRound,
    setLeaderboard, setReviewRoundNumber,
  } = useGame();
  const isCountdown = phase === 'countdown';

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerPresence, setAnswerPresence] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState(5);
  const [endingRound, setEndingRound] = useState(false);
  const [donePlayerIds, setDonePlayerIds] = useState<string[]>([]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Ref mirror of `submitted` so timer closures always read the current value
  // and don't fire duplicate auto-submits due to stale closure capture.
  const submittedRef = useRef(false);

  // Restore answer draft from localStorage on mount / round change
  useEffect(() => {
    if (!gameId || !currentRound?.roundNumber) return;
    const key = `draft_${gameId}_${currentRound.roundNumber}`;
    const stored = localStorage.getItem(key);
    if (!stored) return;
    try {
      const { answers: savedAnswers, submitted: savedSubmitted } = JSON.parse(stored) as {
        answers: Record<string, string>;
        submitted: boolean;
      };
      if (savedAnswers) setAnswers(savedAnswers);
      if (savedSubmitted) {
        setSubmitted(true);
        submittedRef.current = true;
      }
    } catch {
      // corrupted — ignore
    }
  }, [gameId, currentRound?.roundNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist answer draft to localStorage on every change
  useEffect(() => {
    if (!gameId || !currentRound?.roundNumber) return;
    const key = `draft_${gameId}_${currentRound.roundNumber}`;
    localStorage.setItem(key, JSON.stringify({ answers, submitted }));
  }, [answers, submitted, gameId, currentRound?.roundNumber]);

  // RoundStarted — set round data and dismiss the countdown overlay
  useSignalREvent(HubEvents.RoundStarted, (payload) => {
    setCurrentRound(payload as RoundInfo);
    setPhase('answering');
  });

  // Leaderboard received after scoring — store it for the review screen
  useSignalREvent(HubEvents.LeaderboardUpdated, (data) => {
    const d = data as { roundNumber: number; leaderboard: { playerId: string; displayName: string; totalScore: number; roundScore: number }[] };
    setLeaderboard(d.leaderboard);
    setReviewRoundNumber(d.roundNumber);
  });

  // Track per-category answer presence for other players (badge display)
  useSignalREvent(HubEvents.PlayerAnswerUpdated, (data) => {
    const { playerId: pid, category, hasAnswer } = data as { playerId: string; category: string; hasAnswer: boolean };
    setAnswerPresence((prev) => {
      const current = prev[category] ?? [];
      if (hasAnswer) {
        return current.includes(pid) ? prev : { ...prev, [category]: [...current, pid] };
      } else {
        return { ...prev, [category]: current.filter((id) => id !== pid) };
      }
    });
  });

  // Track who has clicked Done in relaxed mode
  useSignalREvent(HubEvents.PlayerDone, (data) => {
    const { playerId: doneId } = data as { playerId: string };
    setDonePlayerIds((prev) => prev.includes(doneId) ? prev : [...prev, doneId]);
  });

  // Round ended by server — auto-submit any unsubmitted answers, then switch phase
  useSignalREvent(HubEvents.RoundEnded, () => {
    if (!submittedRef.current) {
      // Fire-and-forget: captures answers typed but not yet submitted.
      // Backend accepts late submissions until scoring completes.
      api.submitAnswers(gameId ?? '', playerId ?? '', answers).catch(() => {});
      submittedRef.current = true;
    }
    if (gameId && currentRound?.roundNumber) {
      localStorage.removeItem(`draft_${gameId}_${currentRound.roundNumber}`);
    }
    setPhase('results');
  });

  // Countdown overlay timer
  useEffect(() => {
    if (!isCountdown) return;
    function tick() {
      if (countdownStartAt) {
        const remaining = (new Date(countdownStartAt).getTime() - Date.now()) / 1000;
        setCountdownSeconds(Math.max(0, Math.ceil(remaining)));
      } else {
        setCountdownSeconds((s) => Math.max(0, s - 1));
      }
    }
    tick();
    const id = setInterval(tick, countdownStartAt ? 100 : 1000);
    return () => clearInterval(id);
  }, [isCountdown, countdownStartAt]);

  // Timer synced to server endsAt (timed mode)
  useEffect(() => {
    if (!currentRound?.endsAt) return;
    function tick() {
      const remaining = (new Date(currentRound!.endsAt!).getTime() - Date.now()) / 1000;
      const clamped = Math.max(0, Math.ceil(remaining));
      setSecondsLeft(clamped);
      // Use the ref (not the stale closure value of `submitted`) so only one
      // auto-submit fires even though the interval keeps ticking at 0.
      if (clamped <= 0 && !submittedRef.current) handleSubmit(true);
    }
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [currentRound?.endsAt]);

  // Reset state when a new round starts
  useEffect(() => {
    setAnswers({});
    setAnswerPresence({});
    setSubmitted(false);
    submittedRef.current = false;
    setSecondsLeft(null);
    setDonePlayerIds([]);
    inputRefs.current[0]?.focus();
  }, [currentRound?.roundNumber]);

  async function handleSubmit(auto = false) {
    if (!gameId || !playerId || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    try {
      await api.submitAnswers(gameId, playerId, answers);
      if (currentRound?.roundNumber) {
        localStorage.removeItem(`draft_${gameId}_${currentRound.roundNumber}`);
      }
    } catch {
      if (!auto) {
        submittedRef.current = false;
        setSubmitted(false);
      }
    }
  }

  async function handleDone() {
    if (!gameId || !playerId || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    try {
      await api.submitAnswers(gameId, playerId, answers);
      await api.markDone(gameId, playerId);
      if (currentRound?.roundNumber) {
        localStorage.removeItem(`draft_${gameId}_${currentRound.roundNumber}`);
      }
    } catch {
      submittedRef.current = false;
      setSubmitted(false);
    }
  }

  async function handleForceEnd() {
    if (!gameId || !playerId || endingRound) return;
    setEndingRound(true);
    try {
      // Best-effort: submit own answers before locking so they're captured.
      // Don't let a submission failure block the force-end.
      if (!submittedRef.current) {
        try {
          await api.submitAnswers(gameId, playerId, answers);
          submittedRef.current = true;
          setSubmitted(true);
        } catch {
          // Submission failed — proceed with force-end anyway
        }
      }
      await api.forceEndRound(gameId, playerId);
    } catch {
      setEndingRound(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const next = inputRefs.current[index + 1];
      if (next) next.focus();
      else if (e.key === 'Enter') handleSubmit();
    } else if (e.key === 'Escape') {
      const category = categories[index];
      const wasFilled = !!(answers[category]?.trim());
      setAnswers((prev) => ({ ...prev, [category]: '' }));
      if (wasFilled && gameId && playerId) {
        notifyAnswerPresence(gameId, playerId, category, false).catch(() => {});
      }
    }
  }

  function handleReaction(emoji: string) {
    if (gameId) sendReaction(gameId, emoji).catch(() => {});
  }

  const timerWarning = secondsLeft !== null && secondsLeft <= 10;
  const filledCount = Object.values(answers).filter((v) => v.trim()).length;
  const categories = currentRound?.categories ?? [];

  return (
    <div className="h-screen bg-[#0b0f14] flex flex-col overflow-hidden">
      {/* Background glows */}
      <div className="pointer-events-none fixed top-0 left-0 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ background: '#3b82f6', opacity: 0.07 }} />
      <div className="pointer-events-none fixed bottom-0 right-0 w-[400px] h-[400px] rounded-full blur-[120px]" style={{ background: '#ec4899', opacity: 0.05 }} />

      {/* Header */}
      <header className="shrink-0 z-40 border-b border-[#263244] bg-[rgba(11,15,20,0.85)] backdrop-blur-md">
        <div className="h-14 px-5 flex items-center justify-between">
          {/* Left: round info */}
          <div className="flex flex-col justify-center">
            <span className="text-xs font-bold uppercase tracking-widest text-[#e5e7eb] leading-tight">
              Round {currentRound?.roundNumber ?? countdownRoundNumber ?? '—'} of {maxRounds}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-[#6b7280] leading-tight mt-0.5">
              {isTimedMode ? 'Timed Mode' : 'Relaxed Mode'}
            </span>
          </div>

          {/* Center: letter */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-black text-xl leading-none"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #ec4899)',
              color: '#fff',
              boxShadow: '0 0 20px rgba(59,130,246,0.4)',
            }}
          >
            {currentRound?.letter ?? countdownLetter ?? '?'}
          </div>

          {/* Right: timer or mode pill */}
          <div className="flex items-center gap-2">
            {isTimedMode ? (
              <div className="flex items-center gap-1.5">
                <ClockIcon warning={timerWarning} />
                <span className={`font-mono font-bold text-base tabular-nums ${timerWarning ? 'text-[#f87171]' : 'text-[#e5e7eb]'}`}>
                  {secondsLeft !== null ? formatTime(secondsLeft) : '--:--'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#161f2b] border border-[#263244]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#9ca3af]">Relaxed Mode</span>
              </div>
            )}
          </div>
        </div>

        {/* Keyboard hint */}
        {!isCountdown && (
          <div className="hidden md:flex px-5 pb-2 items-center gap-1">
            <span className="text-[10px] text-[#4b5563]">Tab / Enter to move</span>
            <span className="text-[10px] text-[#374151]">•</span>
            <span className="text-[10px] text-[#4b5563]">Esc to clear</span>
          </div>
        )}
      </header>

      {/* Body: grid + sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main: category grid */}
        <main className="flex-1 overflow-y-auto p-4 pb-20 md:pb-4">
          <div className="grid grid-cols-2 gap-3 max-w-3xl">
            {categories.map((category, i) => {
              const filled = !!answers[category]?.trim();
              const presenceIds = (answerPresence[category] ?? []).filter((id) => id !== playerId);
              const presencePlayers = presenceIds.map((id) => players.find((p) => p.id === id)).filter(Boolean) as typeof players;
              return (
                <div
                  key={category}
                  className={`relative bg-[#111827] border rounded-xl px-4 py-3 transition-colors ${filled ? 'border-[#3b82f6]' : 'border-[#263244]'}`}
                >
                  {presencePlayers.length > 0 && (
                    <div className="absolute top-2 right-2 flex items-center">
                      {presencePlayers.slice(0, 3).map((p, idx) => (
                        <div key={p.id} style={{ marginLeft: idx === 0 ? 0 : -6, zIndex: presencePlayers.length - idx }}>
                          <PlayerAvatar name={p.displayName} size={20} />
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[#6b7280] mb-1.5">
                    {category}
                  </label>
                  <input
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    disabled={submitted}
                    value={answers[category] ?? ''}
                    onChange={(e) => {
                      const newVal = e.target.value;
                      const wasFilled = !!(answers[category]?.trim());
                      const nowFilled = !!newVal.trim();
                      setAnswers((prev) => ({ ...prev, [category]: newVal }));
                      if (gameId && playerId && wasFilled !== nowFilled) {
                        notifyAnswerPresence(gameId, playerId, category, nowFilled).catch(() => {});
                      }
                    }}
                    onKeyDown={(e) => handleKeyDown(e, i)}
                    placeholder={`Starts with ${currentRound?.letter ?? '?'}…`}
                    className="w-full bg-transparent text-[#e5e7eb] text-sm font-medium outline-none placeholder-[#374151] disabled:opacity-50"
                  />
                </div>
              );
            })}
          </div>
        </main>

        {/* Sidebar */}
        <aside className="hidden md:flex md:w-72 shrink-0 border-l border-[#263244] bg-[#0d1117] flex-col overflow-y-auto">
          {isTimedMode ? (
            <TimedSidebar
              filledCount={filledCount}
              total={categories.length}
              players={players}
              playerId={playerId}
              isHost={isHost}
              endingRound={endingRound}
              onForceEnd={handleForceEnd}
              onReaction={handleReaction}
            />
          ) : (
            <RelaxedSidebar
              players={players}
              playerId={playerId}
              donePlayerIds={donePlayerIds}
              submitted={submitted}
              isHost={isHost}
              endingRound={endingRound}
              onDone={handleDone}
              onForceEnd={handleForceEnd}
              onReaction={handleReaction}
            />
          )}
        </aside>

        {/* Mobile-only bottom action bar */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0d1117] border-t border-[#263244] px-4 pt-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-center gap-3">
            {/* Reactions (compact) */}
            <div className="flex items-center gap-2 flex-1">
              {REACTIONS.map((emoji) => (
                <button key={emoji} onClick={() => handleReaction(emoji)}
                  className="text-lg leading-none active:scale-95 transition-transform">
                  {emoji}
                </button>
              ))}
            </div>
            {/* Timed: progress pill */}
            {isTimedMode && (
              <span className="text-xs font-mono text-[#9ca3af]">
                {filledCount}/{categories.length}
              </span>
            )}
            {/* Relaxed: Done button */}
            {!isTimedMode && (
              <button onClick={handleDone} disabled={submitted}
                className="h-10 px-5 rounded-xl font-bold text-sm disabled:opacity-50"
                style={{ background: submitted ? '#1f2937' : '#3b82f6', color: submitted ? '#6b7280' : '#0b0f14' }}>
                {submitted ? 'Submitted ✓' : 'Done'}
              </button>
            )}
            {/* Host: force end (both modes) */}
            {isHost && (
              <button onClick={handleForceEnd} disabled={endingRound}
                className="h-10 px-3 rounded-xl font-bold text-xs disabled:opacity-50"
                style={{ border: '1px solid #ef4444', color: '#ef4444' }}>
                {endingRound ? '…' : 'End'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Countdown overlay */}
      {isCountdown && (
        <CountdownOverlay
          seconds={countdownSeconds}
          letter={countdownLetter ?? currentRound?.letter ?? '?'}
          roundNumber={currentRound?.roundNumber ?? countdownRoundNumber ?? null}
        />
      )}
    </div>
  );
}

// --- Timed Mode Sidebar ---

function TimedSidebar({
  filledCount, total, players, playerId, isHost, endingRound, onForceEnd, onReaction,
}: {
  filledCount: number;
  total: number;
  players: { id: string; displayName: string; isHost: boolean; isSpectating?: boolean }[];
  playerId: string | null;
  isHost: boolean;
  endingRound: boolean;
  onForceEnd: () => void;
  onReaction: (emoji: string) => void;
}) {
  const pct = total > 0 ? (filledCount / total) * 100 : 0;
  return (
    <>
      {/* PROGRESS */}
      <section className="p-4 border-b border-[#1a2333]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280]">Progress</span>
          <span className="font-bold text-base text-[#3b82f6] tabular-nums">{filledCount}/{total}</span>
        </div>
        <div className="h-1.5 bg-[#161f2b] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, background: 'linear-gradient(to right, #3b82f6, #ec4899)' }}
          />
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <WarningIcon />
          <span className="text-[10px] text-[#6b7280]">Answers lock when time ends</span>
        </div>
      </section>

      {/* PLAYERS */}
      <PlayerList players={players} playerId={playerId} />

      {/* End round — host only */}
      {isHost && (
        <section className="p-4 border-t border-[#1a2333] flex flex-col gap-1">
          <button
            onClick={onForceEnd}
            disabled={endingRound}
            className="w-full h-9 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444' }}
          >
            <WarningIcon color="#ef4444" />
            <span>{endingRound ? 'Ending round…' : 'End round early'}</span>
          </button>
          <span className="text-center text-[10px] text-[#4b5563]">Host only — use if someone is AFK</span>
        </section>
      )}

      {/* REACTIONS */}
      <ReactionBar onReaction={onReaction} />
    </>
  );
}

// --- Relaxed Mode Sidebar ---

function RelaxedSidebar({
  players, playerId, donePlayerIds, submitted, isHost, endingRound, onDone, onForceEnd, onReaction,
}: {
  players: { id: string; displayName: string; isHost: boolean; isSpectating?: boolean }[];
  playerId: string | null;
  donePlayerIds: string[];
  submitted: boolean;
  isHost: boolean;
  endingRound: boolean;
  onDone: () => void;
  onForceEnd: () => void;
  onReaction: (emoji: string) => void;
}) {
  const activePlayers = players.filter((p) => !p.isSpectating);
  const doneCount = donePlayerIds.length;

  return (
    <>
      {/* PLAYERS */}
      <PlayerList players={players} playerId={playerId} />

      {/* STATUS */}
      <section className="p-4 border-t border-[#1a2333] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280]">Status</span>
          <span className="text-xs font-bold text-[#3b82f6]">Players done: {doneCount}/{activePlayers.length}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          {activePlayers.map((p) => {
            const done = donePlayerIds.includes(p.id);
            return (
              <div key={p.id} className="flex items-center gap-2">
                {done ? (
                  <CheckCircleIcon />
                ) : (
                  <ClockCircleIcon />
                )}
                <span className={`text-xs font-medium ${done ? 'text-[#e5e7eb]' : 'text-[#6b7280]'}`}>
                  {p.displayName}{p.id === playerId ? ' (You)' : ''}
                </span>
              </div>
            );
          })}
        </div>

        {/* Done button */}
        <button
          onClick={onDone}
          disabled={submitted}
          className="w-full h-10 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: submitted ? '#1f2937' : '#3b82f6',
            color: submitted ? '#6b7280' : '#0b0f14',
            boxShadow: submitted ? 'none' : '0 0 16px rgba(59,130,246,0.3)',
          }}
        >
          {submitted ? (
            <>
              <SmallCheckIcon />
              <span>Submitted</span>
            </>
          ) : (
            <span>Done</span>
          )}
        </button>

        {/* End round — host only */}
        {isHost && (
          <div className="flex flex-col gap-1">
            <button
              onClick={onForceEnd}
              disabled={endingRound}
              className="w-full h-9 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'transparent',
                border: '1px solid #ef4444',
                color: '#ef4444',
              }}
            >
              <WarningIcon color="#ef4444" />
              <span>{endingRound ? 'Ending round…' : 'End round'}</span>
            </button>
            <span className="text-center text-[10px] text-[#4b5563]">Host only — use if someone is AFK</span>
          </div>
        )}
      </section>

      {/* REACTIONS */}
      <ReactionBar onReaction={onReaction} />
    </>
  );
}

// --- Shared sidebar components ---

function PlayerList({ players, playerId }: { players: { id: string; displayName: string; isHost: boolean; isSpectating?: boolean }[]; playerId: string | null }) {
  return (
    <section className="p-4 border-b border-[#1a2333] flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280]">Players</span>
        <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
      </div>
      <div className="flex flex-col gap-1.5">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <PlayerAvatar name={p.displayName} size={28} />
            <span className="text-xs font-medium text-[#e5e7eb] flex-1 truncate">
              {p.displayName}{p.id === playerId ? ' (You)' : ''}
            </span>
            {p.isHost && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#1f2937] text-[#ec4899] border border-[#ec4899]/30">
                HOST
              </span>
            )}
            {p.isSpectating && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#1f2937] text-[#6b7280] border border-[#374151]">
                SPEC
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ReactionBar({ onReaction }: { onReaction: (emoji: string) => void }) {
  return (
    <section className="p-4 border-t border-[#1a2333] mt-auto">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280] block mb-2">Reactions</span>
      <div className="flex items-center gap-2">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onReaction(emoji)}
            className="text-lg leading-none hover:scale-125 transition-transform active:scale-95"
          >
            {emoji}
          </button>
        ))}
      </div>
    </section>
  );
}

// --- Countdown overlay (unchanged) ---

function CountdownOverlay({ seconds, letter, roundNumber }: { seconds: number; letter: string; roundNumber: number | null }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,15,20,0.9)]">
      <div className="flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <span className="text-sm font-medium uppercase tracking-[1.25px] text-[#9ca3af]">
            {roundNumber != null ? `Round ${roundNumber}` : 'Round'}
          </span>
          <span className="text-xs font-medium uppercase tracking-[1.2px] text-[#9ca3af]">Letter</span>
        </div>
        <div className="relative flex items-center justify-center w-40 h-40">
          <div
            className="absolute inset-0 rounded-full opacity-30 blur-[64px]"
            style={{ background: 'linear-gradient(180deg, #3b82f6 0%, #ec4899 100%)' }}
          />
          <div className="absolute inset-0 rounded-[32px] bg-[#161f2b] border border-[#263244] flex items-center justify-center shadow-[0px_25px_50px_0px_rgba(0,0,0,0.25)]">
            <span
              className="text-[96px] font-bold leading-none bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(180deg, #e5e7eb 0%, #9ca3af 100%)' }}
            >
              {letter}
            </span>
          </div>
        </div>
        <span className="font-mono text-2xl text-[#3b82f6]">Starting in {seconds}…</span>
      </div>
    </div>
  );
}

// --- Small utilities ---

function PlayerAvatar({ name, size }: { name: string; size: number }) {
  const initials = name.slice(0, 1).toUpperCase();
  const colors = ['#3b82f6', '#ec4899', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4'];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, background: color, fontSize: size * 0.45 }}
    >
      {initials}
    </div>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function ClockIcon({ warning }: { warning?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={warning ? '#f87171' : '#9ca3af'} strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" />
    </svg>
  );
}

function WarningIcon({ color = '#f59e0b' }: { color?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22,4 12,14.01 9,11.01" />
    </svg>
  );
}

function ClockCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" />
    </svg>
  );
}

function SmallCheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20,6 9,17 4,12" />
    </svg>
  );
}

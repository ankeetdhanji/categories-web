import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Zap, Flame, Clock, Sparkles, Send, ChevronLeft, ChevronRight } from 'lucide-react';
import { useGame, type RoundInfo } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api } from '../services/api';
import { notifyAnswerPresence, HubEvents } from '../services/signalr';

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #51a2ff 0%, #00d3f3 100%)',
  'linear-gradient(135deg, #fb64b6 0%, #ff2056 100%)',
  'linear-gradient(135deg, #ffb900 0%, #ff8904 100%)',
  'linear-gradient(135deg, #00d492 0%, #00bcd4 100%)',
  'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
  'linear-gradient(135deg, #05df72 0%, #00bc7d 100%)',
];

function getGradient(name: string) {
  return AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length];
}

function BounceDots({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const dotClass = size === 'lg' ? 'w-2 h-2' : 'w-1.5 h-1.5';
  return (
    <span className="flex space-x-1">
      {[0, 1, 2].map((j) => (
        <motion.span
          key={j}
          className={`${dotClass} bg-cyan-400 rounded-full inline-block`}
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: j * 0.15 }}
        />
      ))}
    </span>
  );
}

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
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const categoryRailRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittedRef = useRef(false);
  const answersRef = useRef<Record<string, string>>({});
  answersRef.current = answers;

  // Auto-scroll rail + auto-focus input when category changes
  useEffect(() => {
    if (categoryRailRef.current) {
      const activeEl = categoryRailRef.current.querySelector('[data-active="true"]');
      if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    inputRef.current?.focus();
  }, [currentCategoryIndex]);

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

  useSignalREvent(HubEvents.RoundStarted, (payload) => {
    setCurrentRound(payload as RoundInfo);
    setPhase('answering');
  });

  useSignalREvent(HubEvents.LeaderboardUpdated, (data) => {
    const d = data as { roundNumber: number; leaderboard: { playerId: string; displayName: string; totalScore: number; roundScore: number }[] };
    setLeaderboard(d.leaderboard);
    setReviewRoundNumber(d.roundNumber);
    setPhase('results');
  });

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

  useSignalREvent(HubEvents.PlayerDone, (data) => {
    const { playerId: doneId } = data as { playerId: string };
    setDonePlayerIds((prev) => prev.includes(doneId) ? prev : [...prev, doneId]);
  });

  useSignalREvent(HubEvents.RoundEnded, () => {
    if (!submittedRef.current) {
      submittedRef.current = true;
      api.submitAnswers(gameId ?? '', playerId ?? '', answersRef.current).catch(() => {});
    }
    if (gameId && currentRound?.roundNumber) {
      localStorage.removeItem(`draft_${gameId}_${currentRound.roundNumber}`);
    }
    // Phase transition happens via LeaderboardUpdated once the backend finishes scoring
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
    const id = setInterval(tick, countdownStartAt ? 250 : 1000);
    return () => clearInterval(id);
  }, [isCountdown, countdownStartAt]);

  // Timer synced to server endsAt (timed mode).
  // Must not run during countdown: currentRound still holds the previous round's stale endsAt
  // (already in the past), which would immediately trigger a ghost auto-submit with empty answers
  // and a ghost markDone that can prematurely end the upcoming round.
  useEffect(() => {
    if (!currentRound?.endsAt || isCountdown) return;
    function tick() {
      const remaining = (new Date(currentRound!.endsAt!).getTime() - Date.now()) / 1000;
      const clamped = Math.max(0, Math.ceil(remaining));
      setSecondsLeft(clamped);
      if (clamped <= 0 && !submittedRef.current) handleSubmit(true);
    }
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [currentRound?.endsAt, isCountdown]);

  // Reset state when a new round starts
  useEffect(() => {
    setAnswers({});
    setAnswerPresence({});
    setSubmitted(false);
    submittedRef.current = false;
    setSecondsLeft(null);
    setDonePlayerIds([]);
    setCurrentCategoryIndex(0);
    inputRef.current?.focus();
  }, [currentRound?.roundNumber]);

  async function handleSubmit(auto = false) {
    if (!gameId || !playerId || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    try {
      await api.submitAnswers(gameId, playerId, answersRef.current);
      if (currentRound?.roundNumber) {
        localStorage.removeItem(`draft_${gameId}_${currentRound.roundNumber}`);
      }
      // Signal done so the round ends immediately when all players have submitted,
      // rather than waiting for the server timer. Errors are swallowed since the
      // server timer is the authoritative ender in timed mode.
      api.markDone(gameId, playerId).catch(() => {});
    } catch {
      submittedRef.current = false;
      if (!auto) setSubmitted(false);
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
      if (!submittedRef.current) {
        try {
          await api.submitAnswers(gameId, playerId, answersRef.current);
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (currentCategoryIndex < categories.length - 1) {
        setCurrentCategoryIndex((prev) => prev + 1);
      } else {
        inputRef.current?.blur();
      }
    } else if (e.key === 'Escape') {
      const category = categories[currentCategoryIndex];
      const wasFilled = !!(answers[category]?.trim());
      setAnswers((prev) => ({ ...prev, [category]: '' }));
      if (wasFilled && gameId && playerId) {
        notifyAnswerPresence(gameId, playerId, category, false).catch(() => {});
      }
    }
  }

  const showSubmittingOverlay = isTimedMode && !isCountdown && secondsLeft !== null && secondsLeft <= 0;

  const isWarning = secondsLeft !== null && secondsLeft <= 15 && secondsLeft > 5;
  const isCritical = secondsLeft !== null && secondsLeft <= 5;

  const filledCount = Object.values(answers).filter((v) => v.trim()).length;
  const categories = currentRound?.categories ?? [];
  const roundNum = isCountdown ? (countdownRoundNumber ?? currentRound?.roundNumber) : currentRound?.roundNumber;
  const letter = currentRound?.letter ?? countdownLetter ?? '?';

  const typingPlayerIds = [...new Set(Object.values(answerPresence).flat())].filter(id => id !== playerId);
  const typingCount = typingPlayerIds.length;

  const progressPercent = categories.length > 0 ? (filledCount / categories.length) * 100 : 0;

  // Current focused category state
  const currentCategory = categories[currentCategoryIndex] ?? '';
  const currentValue = answers[currentCategory] ?? '';
  const currentIsFilled = !!currentValue.trim();
  const currentIsInvalid = currentIsFilled && currentValue.trim().charAt(0).toUpperCase() !== letter.toUpperCase();
  const currentIsCompleted = currentIsFilled && !currentIsInvalid;
  const currentPresenceIds = (answerPresence[currentCategory] ?? []).filter((id) => id !== playerId);
  const currentPresencePlayers = currentPresenceIds
    .map((id) => players.find((p) => p.id === id))
    .filter(Boolean) as typeof players;

  return (
    <div
      className="h-[100dvh] flex flex-col relative overflow-hidden"
      style={{ background: 'linear-gradient(144.77deg, #1e1a4d 0%, #59168b 50%, #312c85 100%)' }}
    >
      {/* Dynamic Background Ambience */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-indigo-500/20 to-transparent" />
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-purple-500 rounded-full opacity-20 blur-[100px]" />
        <div className="absolute bottom-0 -left-32 w-96 h-96 bg-pink-500 rounded-full opacity-10 blur-[100px]" />

        {/* Ambient sparkles — CSS animations (compositor thread, no JS overhead) */}
        <div className="absolute top-20 right-10 text-yellow-300 opacity-60 animate-bounce" style={{ animationDuration: '3s' }}>
          <Sparkles size={24} />
        </div>
        <div className="absolute top-40 left-12 text-pink-300 opacity-50 animate-bounce" style={{ animationDuration: '4s', animationDelay: '1s' }}>
          <Sparkles size={16} />
        </div>
        <div className="absolute bottom-1/3 right-16 text-cyan-300 opacity-40 animate-bounce" style={{ animationDuration: '5s', animationDelay: '0.5s' }}>
          <Zap size={28} fill="currentColor" />
        </div>

        {/* Urgency pulse overlays */}
        <AnimatePresence>
          {isCritical && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-red-600/15 animate-pulse"
              style={{ animationDuration: '0.8s' }}
            />
          )}
          {isWarning && !isCritical && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-orange-500/8 animate-pulse"
              style={{ animationDuration: '1.5s' }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Top nav */}
      <header className="shrink-0 z-40 pt-4 px-4">
        <div className="max-w-[672px] mx-auto flex items-start justify-between gap-3">
          {/* Left: round pill + player avatars */}
          <div className="flex flex-col gap-3">
            {/* Round pill */}
            <div className="inline-flex items-center gap-2 h-[34px] px-[17px] self-start rounded-full bg-black/40 border border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
              <Flame size={12} className="text-cyan-400" />
              <span
                className="text-[11px] font-black uppercase tracking-[1.16px] bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(90deg, #00d3f3 0%, #51a2ff 100%)' }}
              >
                Round {roundNum}
              </span>
              <div className="w-1 h-1 rounded-full bg-white/30" />
              <span className="font-bold text-[12px] text-[#00d3f3]">{filledCount}</span>
              <span className="font-bold text-[12px] text-white/90"> / {categories.length || maxRounds}</span>
            </div>

            {/* Player avatar stack with done/typing states */}
            <div className="flex items-center">
              {players.slice(0, 4).map((p, i) => {
                const isDone = donePlayerIds.includes(p.id);
                return (
                  <div
                    key={p.id}
                    className="relative hover:z-20 hover:scale-110 transition-transform"
                    style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}
                  >
                    <div
                      className={`rounded-full flex items-center justify-center font-black text-white border-2 border-[#1e1a4d] shadow-lg
                        ${isDone ? 'ring-2 ring-green-400/50' : ''}`}
                      style={{
                        width: 32,
                        height: 32,
                        fontSize: 11,
                        background: isDone
                          ? 'linear-gradient(135deg, #4ade80, #10b981)'
                          : getGradient(p.displayName),
                      }}
                    >
                      {isDone ? <CheckCircle2 size={14} strokeWidth={4} /> : p.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    {/* Typing pulse dot (other players only) */}
                    {!isDone && p.id !== playerId && typingPlayerIds.includes(p.id) && (
                      <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-[#1e1a4d] rounded-full flex items-center justify-center border border-white/10">
                        <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_5px_rgba(34,211,238,0.8)]" />
                      </div>
                    )}
                    {/* ME badge */}
                    {p.id === playerId && (
                      <div className="absolute -top-1 -right-1 bg-white/20 backdrop-blur-sm rounded-full px-1 py-0.5 text-[8px] font-black border border-white/10">
                        ME
                      </div>
                    )}
                  </div>
                );
              })}
              {players.length > 4 && (
                <div
                  className="ml-2 rounded-full bg-white/5 border border-white/5 px-2 flex items-center"
                  style={{ height: 25, fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}
                >
                  {players.length - 4}
                </div>
              )}
            </div>
          </div>

          {/* Right: Timer box */}
          <motion.div
            animate={{
              scale: isCritical ? [1, 1.15, 1] : isWarning ? [1, 1.05, 1] : 1,
              rotate: isCritical ? [0, -2, 2, -2, 0] : 0,
            }}
            transition={{ repeat: (isCritical || isWarning) ? Infinity : 0, duration: isCritical ? 0.4 : 1 }}
            className={`relative flex flex-col items-center justify-center w-[72px] h-[72px] rounded-[20px] border overflow-hidden shrink-0
              ${isCritical
                ? 'bg-red-950/80 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.6)]'
                : isWarning
                  ? 'bg-orange-950/80 border-orange-500/80 shadow-[0_0_20px_rgba(249,115,22,0.4)]'
                  : 'bg-black/40 border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]'
              }`}
          >
            {(isCritical || isWarning) && (
              <div
                className={`absolute inset-0 opacity-20 ${isCritical ? 'bg-red-500' : 'bg-orange-500'} animate-ping`}
                style={{ animationDuration: isCritical ? '0.8s' : '1.5s' }}
              />
            )}
            {isTimedMode ? (
              <div className="relative flex flex-col items-center">
                <span className={`font-black text-[28px] leading-7 tracking-tight tabular-nums
                  ${isCritical
                    ? 'text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.8)]'
                    : isWarning
                      ? 'text-orange-400 drop-shadow-[0_0_5px_rgba(251,146,60,0.8)]'
                      : 'text-yellow-400 drop-shadow-md'
                  }`}>
                  {secondsLeft !== null ? Math.min(secondsLeft, 99) : '--'}
                </span>
                <span className={`text-[9px] font-bold uppercase tracking-widest mt-0.5 flex items-center gap-0.5
                  ${isCritical ? 'text-red-300' : isWarning ? 'text-orange-300' : 'text-white/40'}`}>
                  {isCritical ? <Zap size={8} className="animate-pulse" /> : <Clock size={8} />} sec
                </span>
              </div>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
                <span className="text-[8px] font-bold uppercase tracking-widest text-[#3b82f6] mt-0.5">Relaxed</span>
              </>
            )}
          </motion.div>
        </div>
      </header>

      {/* Main content — overflow-y-auto so browser scrolls this div (not the page) when keyboard opens, keeping the header in view */}
      <div className="flex-1 overflow-y-auto z-10">
      <div className="max-w-md mx-auto px-4 pt-6 flex flex-col items-center" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>

        {/* Horizontal category rail */}
        <div className="w-full relative mb-4">
          <div
            ref={categoryRailRef}
            className="w-full flex items-center overflow-x-auto hide-scrollbar snap-x snap-mandatory scroll-smooth bg-indigo-950/40 backdrop-blur-xl border border-white/10 rounded-full p-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.3)] relative"
          >
            {categories.map((cat, idx) => {
              const val = answers[cat] ?? '';
              const isFilled = !!val.trim();
              const isInvalid = isFilled && val.trim().charAt(0).toUpperCase() !== letter.toUpperCase();
              const isCompleted = isFilled && !isInvalid;
              const isActive = idx === currentCategoryIndex;
              const shortCat = cat.length > 12 ? cat.substring(0, 10) + '…' : cat;

              return (
                <div key={cat} className="relative snap-center shrink-0">
                  {isActive && (
                    <motion.div
                      layoutId="activeCategoryPill"
                      className="absolute inset-0 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full shadow-[0_0_15px_rgba(99,102,241,0.6)]"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <button
                    data-active={isActive}
                    onClick={() => setCurrentCategoryIndex(idx)}
                    className={`relative z-10 px-4 py-2 rounded-full text-[11px] font-black whitespace-nowrap transition-colors flex items-center gap-1.5 uppercase tracking-wider
                      ${isActive
                        ? 'text-white'
                        : isInvalid
                          ? 'text-red-300'
                          : isCompleted
                            ? 'text-cyan-200'
                            : 'text-white/50 hover:text-white/80'
                      }`}
                  >
                    {isCompleted && !isActive && <CheckCircle2 size={12} className="text-cyan-400" />}
                    {isInvalid && !isActive && <Zap size={12} className="text-red-400" />}
                    {shortCat}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Slim progress bar */}
        <div className="w-full px-2 mb-6">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Round Progress</span>
            <motion.span
              key={filledCount}
              initial={{ scale: 1.5, color: '#22d3ee' }}
              animate={{ scale: 1, color: '#a5f3fc' }}
              className="text-[10px] font-black text-cyan-200"
            >
              {filledCount} of {categories.length}
            </motion.span>
          </div>
          <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5 relative">
            <motion.div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_0_10px_rgba(34,211,238,0.8)] rounded-full"
              animate={{ width: `${progressPercent}%` }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
            <motion.div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,1)]"
              animate={{ left: `calc(${progressPercent}% - 6px)` }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              style={{ display: progressPercent > 0 ? 'block' : 'none' }}
            />
          </div>
        </div>

        {/* Single-focus input panel */}
        <div className="w-full relative h-[9.5rem] mb-4">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={currentCategoryIndex}
              initial={{ opacity: 0, x: 20, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -20, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="absolute inset-0 w-full h-full"
            >
              <div className={`w-full h-full rounded-[2rem] border flex flex-col p-4 shadow-2xl transition-colors duration-300 backdrop-blur-xl relative overflow-hidden
                ${currentIsInvalid
                  ? 'bg-red-950/30 border-red-500/40 shadow-[0_8px_32px_rgba(239,68,68,0.2)]'
                  : currentIsCompleted
                    ? 'bg-cyan-950/20 border-cyan-400/40 shadow-[0_8px_32px_rgba(34,211,238,0.15)]'
                    : 'bg-indigo-900/30 border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] hover:border-white/20'
                }`}
              >
                {/* Ambient glow inside card */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 blur-3xl rounded-full pointer-events-none" />

                {/* Label row */}
                <div className="flex items-center justify-between mb-3 relative z-10">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-black uppercase tracking-widest
                      ${currentIsInvalid ? 'text-red-300' : currentIsCompleted ? 'text-cyan-300' : 'text-purple-200/80'}`}>
                      {currentCategory}
                    </span>
                    {/* Presence avatars */}
                    {currentPresencePlayers.length > 0 && (
                      <div className="flex items-center">
                        {currentPresencePlayers.slice(0, 3).map((p, idx) => (
                          <div key={p.id} style={{ marginLeft: idx === 0 ? 0 : -6 }}>
                            <div
                              className="rounded-full flex items-center justify-center font-black text-white"
                              style={{
                                width: 18,
                                height: 18,
                                fontSize: 8,
                                background: getGradient(p.displayName),
                                border: '1px solid rgba(30,26,77,0.8)',
                              }}
                            >
                              {p.displayName.slice(0, 1).toUpperCase()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <AnimatePresence>
                    {currentIsCompleted && (
                      <motion.div initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }}>
                        <CheckCircle2 size={18} className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Input area */}
                <div className={`relative flex-1 flex items-center w-full bg-black/20 rounded-[1.25rem] p-2 border border-white/5 shadow-inner transition-all duration-300 z-10
                  ${currentIsInvalid ? 'focus-within:bg-black/40 focus-within:border-red-500/50' : 'focus-within:bg-black/40 focus-within:border-cyan-400/40'}`}
                >
                  {/* Target letter block */}
                  <div className={`flex items-center justify-center w-12 h-12 rounded-[0.85rem] mr-3 shadow-md border transition-colors shrink-0
                    ${currentIsInvalid
                      ? 'bg-red-900/60 border-red-500/40 text-red-300'
                      : currentIsCompleted
                        ? 'bg-cyan-900/40 border-cyan-500/30 text-cyan-200'
                        : 'bg-gradient-to-br from-indigo-500 to-purple-600 border-indigo-400/50 text-white'
                    }`}
                  >
                    <span className="font-black text-2xl">{letter}</span>
                  </div>

                  <div className="relative flex-1 flex items-center h-full">
                    {/* Blinking cursor when empty */}
                    <AnimatePresence>
                      {!currentIsFilled && (
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: [1, 0, 1] }}
                          transition={{ repeat: Infinity, duration: 1 }}
                          className="absolute left-1 text-cyan-400 font-light text-3xl -mt-1 pointer-events-none"
                        >
                          |
                        </motion.span>
                      )}
                    </AnimatePresence>
                    <input
                      ref={(el) => { inputRef.current = el; }}
                      type="text"
                      disabled={submitted}
                      value={currentValue}
                      onChange={(e) => {
                        const newVal = e.target.value;
                        const wasFilled = !!(answers[currentCategory]?.trim());
                        const nowFilled = !!newVal.trim();
                        setAnswers((prev) => ({ ...prev, [currentCategory]: newVal }));
                        if (gameId && playerId && wasFilled !== nowFilled) {
                          notifyAnswerPresence(gameId, playerId, currentCategory, nowFilled).catch(() => {});
                        }
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder=""
                      className={`w-full bg-transparent outline-none font-bold text-2xl transition-all duration-200 ml-1 disabled:opacity-50
                        ${currentIsInvalid ? 'text-red-300' : currentIsCompleted ? 'text-white drop-shadow-md' : 'text-white'}`}
                      style={{ caretColor: '#00d3f3' }}
                    />
                  </div>

                  {/* Error feedback floating tag */}
                  <AnimatePresence>
                    {currentIsInvalid && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute -top-3 right-4 text-red-100 text-[9px] font-black uppercase tracking-wider flex items-center gap-1 bg-red-600 px-2 py-0.5 rounded-full border border-red-400 shadow-md"
                      >
                        <Zap size={10} /> Starts with {letter}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Prev/Next navigation buttons */}
        <div className="flex w-full gap-2 relative z-20">
          <button
            onClick={() => setCurrentCategoryIndex((prev) => Math.max(0, prev - 1))}
            disabled={currentCategoryIndex === 0}
            className="flex items-center justify-center py-3.5 px-5 rounded-2xl bg-white/5 backdrop-blur-md text-white font-bold border border-white/10 active:bg-white/10 disabled:opacity-30 disabled:active:bg-white/5 transition-colors shadow-lg"
          >
            <ChevronLeft size={22} />
          </button>

          <button
            onClick={() => setCurrentCategoryIndex((prev) => Math.min(categories.length - 1, prev + 1))}
            disabled={currentCategoryIndex === categories.length - 1}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-blue-500/90 to-cyan-500/90 backdrop-blur-md text-white font-black active:scale-[0.98] disabled:opacity-30 disabled:grayscale disabled:active:scale-100 transition-all shadow-[0_4px_15px_rgba(6,182,212,0.3)] text-sm tracking-wider uppercase border border-cyan-400/30 hover:border-cyan-300"
          >
            Next Category <ChevronRight size={18} />
          </button>
        </div>

        {/* Submit bar — inline, always visible directly below nav buttons */}
        <div className="w-full mt-4 flex flex-col gap-2">
          <div className="w-full bg-indigo-950/95 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 flex items-center justify-between shadow-[0_10px_40px_rgba(0,0,0,0.4)]">
            {/* Left: finish early info + typing */}
            <div className="flex flex-col justify-center pl-3">
              <div className="flex items-center gap-2">
                <span className="text-white/90 text-xs font-bold leading-tight">Finish Early</span>
                <span className="text-white/50 text-xs font-bold">•</span>
                <span className="text-cyan-400 text-xs font-black">{filledCount}/{categories.length}</span>
              </div>
              <span className="text-white/40 text-[9px] font-bold uppercase tracking-wider mt-0.5 flex items-center gap-1">
                {typingCount > 0 ? (
                  <><BounceDots />{typingCount} typing</>
                ) : (
                  <span className="text-emerald-400/70">No one typing</span>
                )}
              </span>
            </div>

            {/* Right: submit button */}
            {isTimedMode ? (
              submitted ? (
                <div className="px-4 py-2.5 rounded-xl flex items-center gap-2 text-white/60 text-xs font-bold">
                  <BounceDots /> Waiting…
                </div>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleSubmit()}
                  className={`px-5 py-2.5 rounded-xl flex items-center justify-center gap-1.5 font-black shadow-md active:scale-95 transition-all text-xs uppercase tracking-wider border
                    ${filledCount === categories.length
                      ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-green-950 border-green-300 shadow-[0_0_15px_rgba(52,211,153,0.5)]'
                      : 'bg-white/10 text-white/80 border-white/20 hover:bg-white/20'
                    }`}
                >
                  {filledCount === categories.length ? 'Submit' : 'Done'}
                  <Send size={14} />
                </motion.button>
              )
            ) : (
              <motion.button
                onClick={handleDone}
                disabled={submitted}
                whileTap={{ scale: 0.95 }}
                className={`px-5 py-2.5 rounded-xl flex items-center justify-center gap-1.5 font-black shadow-md transition-all text-xs uppercase tracking-wider border disabled:opacity-50
                  ${submitted
                    ? 'bg-white/5 border-white/10 text-white/50'
                    : filledCount === categories.length
                      ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-green-950 border-green-300 shadow-[0_0_15px_rgba(52,211,153,0.5)]'
                      : 'bg-white/10 text-white/80 border-white/20 hover:bg-white/20'
                  }`}
              >
                {submitted ? 'Submitted ✓' : 'Done'}
                {!submitted && <Send size={14} />}
              </motion.button>
            )}
          </div>

          {/* Host force-end */}
          {isHost && (
            <div className="flex justify-center">
              <button
                onClick={handleForceEnd}
                disabled={endingRound}
                className="text-[10px] font-bold text-red-400/50 hover:text-red-400 disabled:opacity-30 transition-colors px-3 py-1"
              >
                {endingRound ? 'Ending round…' : 'Force end round'}
              </button>
            </div>
          )}
        </div>

      </div>
      </div>

      {/* Countdown overlay */}
      <AnimatePresence>
        {isCountdown && (
          <CountdownOverlay
            seconds={countdownSeconds}
            letter={countdownLetter ?? currentRound?.letter ?? '?'}
            roundNumber={countdownRoundNumber ?? currentRound?.roundNumber ?? null}
            players={players}
          />
        )}
      </AnimatePresence>

      {/* Submitting overlay — shown after timer expires until LeaderboardUpdated fires */}
      <AnimatePresence>
        {showSubmittingOverlay && <SubmittingOverlay />}
      </AnimatePresence>
    </div>
  );
}

// --- Submitting overlay (shown after timer expires, until LeaderboardUpdated fires) ---

function SubmittingOverlay() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(30,26,77,0.92)', backdropFilter: 'blur(12px)' }}
    >
      <div className="flex flex-col items-center gap-6">
        <span className="text-sm font-black uppercase tracking-[1.25px] text-white/50">
          Time&apos;s Up!
        </span>
        <div className="flex gap-2">
          {[0, 1, 2].map((j) => (
            <motion.div
              key={j}
              className="w-3 h-3 rounded-full"
              style={{ background: 'linear-gradient(135deg, #00d3f3, #51a2ff)' }}
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 0.7, repeat: Infinity, delay: j * 0.15 }}
            />
          ))}
        </div>
        <p className="font-bold text-[18px] text-white/80 tracking-tight">
          Submitting your answers…
        </p>
      </div>
    </motion.div>
  );
}

// --- Countdown overlay ---

type Player = { id: string; displayName: string };

function CountdownOverlay({
  seconds,
  letter,
  roundNumber,
  players,
}: {
  seconds: number;
  letter: string;
  roundNumber: number | null;
  players: Player[];
}) {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-indigo-950 via-purple-900 to-indigo-950 overflow-hidden"
    >
      {/* Ambient energy layer */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%] left-[20%] w-[30rem] h-[30rem] bg-purple-600/30 rounded-full blur-[100px]" />
        <div className="absolute bottom-[10%] right-[10%] w-[30rem] h-[30rem] bg-blue-600/20 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-orange-500/10 rounded-full blur-[100px]" />

        <div className="absolute top-[20%] left-[15%] text-yellow-300 opacity-60 animate-bounce" style={{ animationDuration: '3s' }}>
          <Sparkles size={40} />
        </div>
        <div className="absolute top-[30%] right-[15%] text-cyan-300 opacity-50 animate-bounce" style={{ animationDuration: '4s', animationDelay: '0.5s' }}>
          <Sparkles size={32} />
        </div>
        <div className="absolute bottom-[25%] left-[25%] text-pink-300 opacity-40 animate-pulse" style={{ animationDuration: '5s', animationDelay: '1s' }}>
          <Sparkles size={24} />
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center w-full max-w-md px-6 text-center mt-[-10vh]">
        {/* Round label (if available) */}
        {roundNumber != null && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-white/40 text-xs font-black uppercase tracking-widest mb-3"
          >
            Round {roundNumber}
          </motion.p>
        )}

        {/* "Get Ready" pill */}
        <motion.div
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-black/40 backdrop-blur-xl rounded-full px-6 py-2.5 flex items-center gap-2.5 border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] mb-10"
        >
          <Flame size={16} className="text-cyan-400" />
          <span className="bg-gradient-to-r from-cyan-400 to-blue-400 text-transparent bg-clip-text text-sm font-black uppercase tracking-widest">
            Get Ready
          </span>
        </motion.div>

        {/* Target letter card */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', bounce: 0.5, delay: 0.2 }}
          className="mb-12 relative flex justify-center w-full"
        >
          <div className="absolute inset-0 bg-orange-500 blur-3xl opacity-40 rounded-full w-48 h-48 mx-auto" />
          <div className="relative bg-gradient-to-b from-yellow-300 to-orange-500 rounded-[2rem] flex flex-col items-center justify-center p-6 shadow-[0_0_50px_rgba(249,115,22,0.4)] border border-white/40 -rotate-2 w-48 h-48">
            <span className="text-[10px] font-black uppercase tracking-widest text-orange-950/60 mb-[-10px] z-10">
              Target Letter
            </span>
            <span
              className="text-[110px] font-black text-orange-950 leading-none"
              style={{ textShadow: '0 4px 20px rgba(0,0,0,0.2)' }}
            >
              {letter}
            </span>
          </div>
        </motion.div>

        {/* Huge animated countdown number */}
        <div className="h-40 flex items-center justify-center w-full">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={seconds}
              initial={{ scale: 0.2, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 1.8, opacity: 0, filter: 'blur(15px)' }}
              transition={{ type: 'spring', bounce: 0.6, duration: 0.6 }}
              className="text-[140px] font-black text-white leading-none drop-shadow-[0_0_40px_rgba(255,255,255,0.4)]"
              style={{ WebkitTextStroke: seconds > 0 ? '2px rgba(255,255,255,0.2)' : 'none' }}
            >
              {seconds > 0 ? seconds : 'GO!'}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Players-ready pill */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="absolute bottom-[-15vh] w-full flex justify-center"
        >
          <div className="flex items-center gap-3 bg-white/5 backdrop-blur-xl rounded-full px-5 py-2.5 border border-white/10 shadow-lg">
            <div className="flex -space-x-2">
              {players.slice(0, 4).map((p) => (
                <div
                  key={p.id}
                  className="w-8 h-8 rounded-full flex items-center justify-center font-black text-white border-2 border-indigo-950 shadow-md text-[11px]"
                  style={{ background: getGradient(p.displayName) }}
                >
                  {p.displayName.slice(0, 1).toUpperCase()}
                </div>
              ))}
            </div>
            <span className="text-sm font-bold text-white/80">Players ready</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

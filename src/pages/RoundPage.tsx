import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useGame, type RoundInfo } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api } from '../services/api';
import { sendReaction, notifyAnswerPresence, HubEvents } from '../services/signalr';

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
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
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

  useSignalREvent(HubEvents.RoundStarted, (payload) => {
    setCurrentRound(payload as RoundInfo);
    setPhase('answering');
  });

  useSignalREvent(HubEvents.LeaderboardUpdated, (data) => {
    const d = data as { roundNumber: number; leaderboard: { playerId: string; displayName: string; totalScore: number; roundScore: number }[] };
    setLeaderboard(d.leaderboard);
    setReviewRoundNumber(d.roundNumber);
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
  const timerClass = secondsLeft !== null && secondsLeft <= 5
    ? 'bg-red-950/80 border-2 border-red-500'
    : secondsLeft !== null && secondsLeft <= 15
    ? 'bg-orange-950/80 border-2 border-orange-500/80'
    : 'bg-black/40 border border-white/10';
  const timerTextColor = secondsLeft !== null && secondsLeft <= 5
    ? 'text-red-400'
    : secondsLeft !== null && secondsLeft <= 15
    ? 'text-orange-400'
    : 'text-[#fdc700]';
  const filledCount = Object.values(answers).filter((v) => v.trim()).length;
  const categories = currentRound?.categories ?? [];
  const roundNum = currentRound?.roundNumber ?? countdownRoundNumber;

  const typingPlayerIds = [...new Set(Object.values(answerPresence).flat())].filter(id => id !== playerId);
  const typingCount = typingPlayerIds.length;
  const lastDonePlayerId = donePlayerIds[donePlayerIds.length - 1];
  const lastDonePlayer = lastDonePlayerId ? players.find(p => p.id === lastDonePlayerId) ?? null : null;

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{ background: 'linear-gradient(144.77deg, #1e1a4d 0%, #59168b 50%, #312c85 100%)' }}
    >
      {/* Decorative background blobs */}
      <div
        className="pointer-events-none fixed top-0 left-0 right-0 h-96 opacity-20"
        style={{ background: 'linear-gradient(to bottom, rgba(97,95,255,0.3), transparent)' }}
      />
      <div
        className="pointer-events-none fixed rounded-full opacity-20"
        style={{ background: '#ad46ff', filter: 'blur(100px)', width: 384, height: 384, top: -128, right: 0 }}
      />
      <div
        className="pointer-events-none fixed rounded-full opacity-10"
        style={{ background: '#f6339a', filter: 'blur(100px)', width: 384, height: 384, bottom: 0, left: -128 }}
      />

      {/* Top nav */}
      <header className="shrink-0 z-40 pt-4 px-4">
        <div className="max-w-[672px] mx-auto flex items-start justify-between gap-3">
          {/* Left: round pill + player avatars */}
          <div className="flex flex-col gap-3">
            {/* Round pill */}
            <div className="inline-flex items-center gap-2 h-[34px] px-[17px] self-start rounded-full bg-black/40 border border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="url(#boltGrad)" />
                <defs>
                  <linearGradient id="boltGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop stopColor="#00d3f3" />
                    <stop offset="1" stopColor="#51a2ff" />
                  </linearGradient>
                </defs>
              </svg>
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

            {/* Player avatar stack */}
            <div className="flex items-center">
              {players.slice(0, 4).map((p, i) => (
                <div key={p.id} className="relative" style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}>
                  <div
                    className="rounded-full flex items-center justify-center font-black text-white border-2 border-[#1e1a4d] shadow-[0_10px_15px_rgba(0,0,0,0.1)]"
                    style={{ width: 32, height: 32, fontSize: 11, background: getGradient(p.displayName) }}
                  >
                    {p.displayName.slice(0, 1).toUpperCase()}
                  </div>
                  {p.id === playerId && (
                    <div
                      className="absolute -top-1 left-3 rounded-full px-[4px] bg-white/20 border border-white/10"
                      style={{ fontSize: 8, fontWeight: 900, color: '#0a0a0a', lineHeight: '14px' }}
                    >
                      ME
                    </div>
                  )}
                </div>
              ))}
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
          <div
            className={`${timerClass} rounded-[20px] w-[72px] h-[72px] shrink-0 flex flex-col items-center justify-center gap-0.5 shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden`}
            style={secondsLeft !== null && secondsLeft <= 5 ? { animation: 'timer-shake 0.5s ease-in-out infinite' } : undefined}
          >
            {isTimedMode ? (
              <>
                <span className={`font-black text-[28px] leading-7 tracking-tight tabular-nums ${timerTextColor}`}>
                  {secondsLeft !== null ? Math.min(secondsLeft, 99) : '--'}
                </span>
                <div className="flex items-center gap-1">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12,6 12,12 16,14" />
                  </svg>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">sec</span>
                </div>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
                <span className="text-[8px] font-bold uppercase tracking-widest text-[#3b82f6] mt-0.5">Relaxed</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Scrollable main content */}
      <main className="flex-1 overflow-y-auto px-4 pt-5 pb-44">
        <div className="max-w-[672px] mx-auto flex flex-col gap-4">

          {/* Letter card */}
          <div
            className="rounded-[32px] p-[7px] border border-white/10 shadow-[0_25px_50px_rgba(0,0,0,0.25)]"
            style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.1), rgba(255,255,255,0.05))' }}
          >
            <div
              className="rounded-[28px] overflow-hidden px-5 py-6 relative"
              style={{ background: 'linear-gradient(167deg, rgba(49,44,133,0.9) 0%, rgba(60,3,102,0.9) 100%)' }}
            >
              {/* Inner blobs */}
              <div
                className="absolute pointer-events-none rounded-full"
                style={{ background: 'rgba(255,105,0,0.2)', filter: 'blur(64px)', width: 160, height: 160, top: -48, right: 0 }}
              />
              <div
                className="absolute pointer-events-none rounded-full"
                style={{ background: 'rgba(43,127,255,0.2)', filter: 'blur(64px)', width: 160, height: 160, top: 16, left: -48 }}
              />

              <div className="relative flex items-center gap-5">
                {/* Letter tile */}
                <div className="relative shrink-0 w-20 h-20">
                  <div
                    className="absolute inset-0 rounded-2xl opacity-40"
                    style={{ background: '#ff6900', filter: 'blur(12px)' }}
                  />
                  <div
                    className="-rotate-3 relative w-20 h-20 rounded-2xl border border-white/20 flex items-center justify-center shadow-[0_10px_15px_rgba(0,0,0,0.1)]"
                    style={{ background: 'linear-gradient(to bottom, #ffdf20, #ff6900)' }}
                  >
                    <span className="font-black text-[48px] text-[#441306] leading-none select-none shadow-[0_1px_4px_rgba(0,0,0,0.15)]">
                      {currentRound?.letter ?? countdownLetter ?? '?'}
                    </span>
                  </div>
                </div>

                {/* Text */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-[1.12px] text-white/50">
                    Target Letter
                  </span>
                  <p className="font-medium text-[16px] text-white/90 leading-snug tracking-[-0.3px]">
                    Every answer must start with{' '}
                    <span className="font-black text-[18px] text-white">
                      {currentRound?.letter ?? countdownLetter ?? '?'}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Round progress */}
          <div className="px-6 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-[1.12px] text-white/50">
                Round Progress
              </span>
              <div
                className="rounded px-2 py-[3px] border"
                style={{
                  background: 'rgba(5,51,69,0.5)',
                  borderColor: 'rgba(0,95,120,0.5)',
                  boxShadow: '0 0 10px rgba(34,211,238,0.2)',
                }}
              >
                <span className="font-black text-[12px] text-[#a5f3fc]">
                  {categories.length > 0 ? Math.round((filledCount / categories.length) * 100) : 0}%
                </span>
              </div>
            </div>
            <div className="relative h-3 rounded-full overflow-hidden border border-white/10">
              <div className="absolute inset-0 rounded-full bg-black/40" />
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                style={{
                  width: `${categories.length > 0 ? (filledCount / categories.length) * 100 : 0}%`,
                  background: 'linear-gradient(to right, #00b8db, #2b7fff, #ad46ff)',
                }}
              >
                <div
                  className="absolute inset-0 rounded-full bg-white/40"
                  style={{ filter: 'blur(8px)' }}
                />
              </div>
              {/* Tick marks */}
              <div className="absolute inset-0 flex items-stretch px-1 pointer-events-none">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex-1 flex justify-end">
                    <div className="w-px bg-white/10 h-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Category grid */}
          <div className="grid grid-cols-2 gap-4 px-2">
            {categories.map((category, i) => {
              const filled = !!answers[category]?.trim();
              const presenceIds = (answerPresence[category] ?? []).filter((id) => id !== playerId);
              const presencePlayers = presenceIds
                .map((id) => players.find((p) => p.id === id))
                .filter(Boolean) as typeof players;
              return (
                <div
                  key={category}
                  className="relative rounded-[20px] overflow-hidden shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)] cursor-text"
                  style={{
                    background: activeCategory === category
                      ? 'rgba(107,33,168,0.8)'
                      : filled
                      ? 'rgba(8,47,73,0.6)'
                      : 'rgba(0,0,0,0.3)',
                    borderBottom: activeCategory === category
                      ? '4px solid rgb(168,85,247)'
                      : filled
                      ? '4px solid rgb(6,182,212)'
                      : '4px solid rgba(0,0,0,0.6)',
                    boxShadow: activeCategory === category
                      ? '0 10px 30px rgba(168,85,247,0.3)'
                      : 'none',
                    transform: activeCategory === category ? 'scale(1.02)' : 'scale(1)',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => inputRefs.current[i]?.focus()}
                >
                  {/* Category header */}
                  <div className="px-3 pt-3 flex items-center justify-between">
                    <span
                      className="text-[12px] font-black uppercase tracking-[0.6px]"
                      style={{ color: activeCategory === category ? 'rgba(216,180,254,0.9)' : filled ? 'rgba(103,232,249,0.7)' : 'rgba(255,255,255,0.4)' }}
                    >
                      {category}
                    </span>
                    {presencePlayers.length > 0 && (
                      <div className="flex items-center">
                        {presencePlayers.slice(0, 3).map((p, idx) => (
                          <div key={p.id} style={{ marginLeft: idx === 0 ? 0 : -6 }}>
                            <div
                              className="rounded-full flex items-center justify-center font-black text-white"
                              style={{
                                width: 18, height: 18, fontSize: 8,
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
                  {/* Input */}
                  <div className="px-3 pb-3 pt-2">
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
                      onFocus={() => setActiveCategory(category)}
                      onBlur={() => setActiveCategory(null)}
                      placeholder="Tap to write"
                      className="w-full bg-transparent text-[16px] font-bold outline-none disabled:opacity-50"
                      style={{
                        color: filled ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.6)',
                        caretColor: '#00d3f3',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </main>

      {/* Bottom status bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none">
        {/* Gradient fade into bar */}
        <div
          className="h-32"
          style={{ background: 'linear-gradient(to top, rgba(30,26,77,0.9) 40%, transparent)' }}
        />
        <div
          className="border-t border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] pointer-events-auto"
          style={{
            background: 'rgba(30,26,77,0.8)',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          }}
        >
          <div className="max-w-[672px] mx-auto px-4 pt-[17px]">
            <div
              className="border border-white/10 rounded-2xl relative overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.05)' }}
            >
              <div className="absolute inset-0 pointer-events-none rounded-2xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]" />
              <div className="flex items-center justify-between px-3 py-1.5 relative">
                {/* Left: player status */}
                {lastDonePlayer ? (
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <div
                        className="rounded-full flex items-center justify-center font-black text-white border-2 border-[#1e1a4d]"
                        style={{
                          width: 36, height: 36, fontSize: 14,
                          background: getGradient(lastDonePlayer.displayName),
                        }}
                      >
                        {lastDonePlayer.displayName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-[#05df72] border-2 border-[#1e1a4d] shadow-[0_0_5px_rgba(74,222,128,0.8)]" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1">
                        <span className="font-black text-[14px] text-white leading-[17.5px]">
                          {lastDonePlayer.id === playerId ? 'You' : lastDonePlayer.displayName} finished!
                        </span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#05df72" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20,6 9,17 4,12" />
                        </svg>
                      </div>
                      {typingCount > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <div className="flex gap-0.5">
                            {[0, 1, 2].map(j => (
                              <div key={j} className="w-1.5 h-1.5 rounded-full bg-[#00d3f3] shadow-[0_0_5px_rgba(34,211,238,0.5)]" />
                            ))}
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-[0.62px] text-[#00d3f3]">
                            {typingCount} other{typingCount !== 1 ? 's' : ''} typing
                          </span>
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-[0.62px] text-white/40">
                          Waiting for others…
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 pl-1">
                    {typingCount > 0 ? (
                      <>
                        <div className="flex gap-0.5">
                          {[0, 1, 2].map(j => (
                            <div key={j} className="w-1.5 h-1.5 rounded-full bg-[#00d3f3] shadow-[0_0_5px_rgba(34,211,238,0.5)]" />
                          ))}
                        </div>
                        <span className="font-black text-[14px] text-white leading-[17.5px]">
                          {typingCount} player{typingCount !== 1 ? 's' : ''} answering
                        </span>
                      </>
                    ) : (
                      <span className="font-black text-[14px] text-white/50 leading-[17.5px]">
                        Round in progress…
                      </span>
                    )}
                  </div>
                )}

                {/* Right: submit control */}
                {isTimedMode ? (
                  submitted ? (
                    <div className="flex items-center gap-2 px-4">
                      <span className="text-[13px] font-bold text-white/60">Waiting for others</span>
                      <div className="flex gap-1">
                        {[0,1,2].map(j => (
                          <motion.div key={j} className="w-1.5 h-1.5 rounded-full bg-white/40"
                            animate={{ y: [0, -4, 0] }}
                            transition={{ duration: 0.6, repeat: Infinity, delay: j * 0.15 }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <motion.button
                      onClick={() => handleSubmit()}
                      disabled={submitted}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      className="h-9 px-5 rounded-xl font-bold text-sm disabled:opacity-50 transition-all"
                      style={{
                        background: filledCount === categories.length
                          ? 'linear-gradient(135deg, #05df72, #00bcd4)'
                          : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                        color: '#fff',
                        boxShadow: filledCount === categories.length
                          ? '0 0 16px rgba(5,223,114,0.4)'
                          : '0 0 16px rgba(59,130,246,0.4)',
                      }}
                    >
                      {filledCount === categories.length
                        ? 'Submit Answers'
                        : `Finish Early (${filledCount}/${categories.length})`}
                    </motion.button>
                  )
                ) : (
                  <motion.button
                    onClick={handleDone}
                    disabled={submitted}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    className="h-9 px-5 rounded-xl font-bold text-sm disabled:opacity-50"
                    style={{
                      background: submitted ? '#1f2937' : filledCount === categories.length
                        ? 'linear-gradient(135deg, #05df72, #00bcd4)'
                        : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                      color: submitted ? '#6b7280' : '#fff',
                      boxShadow: submitted ? 'none' : '0 0 16px rgba(59,130,246,0.4)',
                    }}
                  >
                    {submitted ? 'Submitted ✓' : 'Done'}
                  </motion.button>
                )}
              </div>
            </div>

            {/* Host force-end */}
            {isHost && (
              <div className="flex justify-center mt-1.5 mb-2">
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
            roundNumber={currentRound?.roundNumber ?? countdownRoundNumber ?? null}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Countdown overlay ---

function CountdownOverlay({ seconds, letter, roundNumber }: { seconds: number; letter: string; roundNumber: number | null }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(30,26,77,0.92)', backdropFilter: 'blur(12px)' }}
    >
      <div className="flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-1">
          {roundNumber != null && (
            <span className="text-sm font-black uppercase tracking-[1.25px] text-white/50">
              Round {roundNumber}
            </span>
          )}
          <span className="text-xs font-bold uppercase tracking-[1.2px] text-white/40">
            Target Letter
          </span>
        </div>
        <div className="relative flex items-center justify-center w-40 h-40">
          <div
            className="absolute inset-0 rounded-[32px] opacity-40"
            style={{ background: 'linear-gradient(180deg, #ff6900 0%, #ffdf20 100%)', filter: 'blur(32px)' }}
          />
          <div
            className="-rotate-3 relative w-40 h-40 rounded-[32px] border border-white/20 flex items-center justify-center shadow-[0_25px_50px_rgba(0,0,0,0.25)]"
            style={{ background: 'linear-gradient(to bottom, #ffdf20, #ff6900)' }}
          >
            <span className="font-black text-[96px] leading-none text-[#441306] select-none">
              {letter}
            </span>
          </div>
        </div>
        <motion.span
          key={seconds}
          initial={{ scale: 1.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="font-bold text-2xl text-white/70 tracking-tight"
        >
          {seconds <= 0 ? 'GO!' : `Starting in `}
          {seconds > 0 && <span className="font-black text-[#00d3f3]">{seconds}</span>}
          {seconds > 0 && '…'}
        </motion.span>
      </div>
    </motion.div>
  );
}

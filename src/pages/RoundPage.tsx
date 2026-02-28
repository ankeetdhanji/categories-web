import { useEffect, useRef, useState } from 'react';
import { useGame } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api } from '../services/api';
import { HubEvents } from '../services/signalr';

export default function RoundPage() {
  const { gameId, playerId, currentRound, setPhase } = useGame();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Round ended by server
  useSignalREvent(HubEvents.RoundEnded, () => {
    setPhase('results');
  });

  // Timer synced to server endsAt
  useEffect(() => {
    if (!currentRound?.endsAt) return;

    function tick() {
      const remaining = (new Date(currentRound!.endsAt!).getTime() - Date.now()) / 1000;
      const clamped = Math.max(0, Math.ceil(remaining));
      setSecondsLeft(clamped);
      if (clamped <= 0 && !submitted) handleSubmit(true);
    }

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [currentRound?.endsAt]);

  // Reset answers when a new round starts
  useEffect(() => {
    setAnswers({});
    setSubmitted(false);
    setSecondsLeft(null);
    inputRefs.current[0]?.focus();
  }, [currentRound?.roundNumber]);

  async function handleSubmit(auto = false) {
    if (!gameId || !playerId || submitted) return;
    setSubmitted(true);
    try {
      await api.submitAnswers(gameId, playerId, answers);
    } catch {
      if (!auto) setSubmitted(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = inputRefs.current[index + 1];
      if (next) next.focus();
      else handleSubmit();
    }
  }

  const timerWarning = secondsLeft !== null && secondsLeft <= 10;
  const filledCount = Object.values(answers).filter((v) => v.trim()).length;
  const categories = currentRound?.categories ?? [];

  if (!currentRound) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0b0f14]">
        <p className="text-[#6b7280]">Waiting for round to start…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0f14] flex flex-col">
      {/* Background glows */}
      <div className="pointer-events-none fixed top-0 left-0 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ background: '#3b82f6', opacity: 0.07 }} />
      <div className="pointer-events-none fixed bottom-0 right-0 w-[400px] h-[400px] rounded-full blur-[120px]" style={{ background: '#ec4899', opacity: 0.05 }} />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[#263244] bg-[rgba(11,15,20,0.85)] backdrop-blur-md">
        <div className="h-16 px-6 flex items-center justify-between">
          {/* Round + letter */}
          <div className="flex items-center gap-4">
            <span className="text-xs font-bold uppercase tracking-widest text-[#6b7280]">
              Round {currentRound.roundNumber}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-[#6b7280]">Letter</span>
              <span
                className="font-black text-3xl leading-none"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #ec4899)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {currentRound.letter}
              </span>
            </div>
          </div>

          {/* Timer + progress */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className={`font-mono font-bold text-lg tabular-nums ${timerWarning ? 'text-[#f87171]' : 'text-[#e5e7eb]'}`}>
                {secondsLeft !== null ? formatTime(secondsLeft) : '--:--'}
              </span>
            </div>
            <div className="text-xs text-[#6b7280]">{filledCount}/{categories.length}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-[#161f2b]">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: categories.length > 0 ? `${(filledCount / categories.length) * 100}%` : '0%',
              background: 'linear-gradient(to right, #3b82f6, #ec4899)',
            }}
          />
        </div>
      </header>

      {/* Category inputs */}
      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full flex flex-col gap-3 pb-32">
        {categories.map((category, i) => {
          const filled = !!answers[category]?.trim();
          return (
            <div
              key={category}
              className={`bg-[#111827] border rounded-xl px-4 py-3 transition-colors ${filled ? 'border-[#3b82f6]' : 'border-[#263244]'}`}
            >
              <label className="block text-xs font-bold uppercase tracking-widest text-[#6b7280] mb-1.5">
                {category}
              </label>
              <input
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                disabled={submitted}
                value={answers[category] ?? ''}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [category]: e.target.value }))}
                onKeyDown={(e) => handleKeyDown(e, i)}
                placeholder={`${currentRound.letter}…`}
                className="w-full bg-transparent text-[#e5e7eb] text-base font-medium outline-none placeholder-[#374151] disabled:opacity-50"
              />
            </div>
          );
        })}
      </main>

      {/* Submit bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-6 pt-4 bg-gradient-to-t from-[#0b0f14] to-transparent">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => handleSubmit()}
            disabled={submitted}
            className="w-full h-14 rounded-[14px] font-bold text-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: submitted ? '#1f2937' : '#3b82f6',
              color: submitted ? '#6b7280' : '#0b0f14',
              boxShadow: submitted ? 'none' : '0px 0px 20px 0px rgba(59,130,246,0.3)',
            }}
          >
            {submitted ? (
              <>
                <CheckIcon />
                <span>Answers submitted</span>
              </>
            ) : (
              <span>Done — submit answers ({filledCount}/{categories.length})</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20,6 9,17 4,12" />
    </svg>
  );
}

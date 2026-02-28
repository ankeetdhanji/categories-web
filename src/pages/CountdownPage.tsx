import { useEffect, useState } from 'react';
import { useGame } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { HubEvents } from '../services/signalr';

const COUNTDOWN_SECONDS = 5;
// SVG circle config for the progress ring
const RADIUS = 80;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function CountdownPage() {
  const { countdownStartAt, setPhase } = useGame();
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  // Transition to answering when RoundStarted fires (authoritative signal from server)
  useSignalREvent(HubEvents.RoundStarted, () => {
    setPhase('answering');
  });

  useEffect(() => {
    if (!countdownStartAt) {
      // Fallback: no startAt in context (e.g. page refresh mid-countdown) — just count from 5
      setSecondsLeft(COUNTDOWN_SECONDS);
    }

    function tick() {
      if (countdownStartAt) {
        const remaining = (new Date(countdownStartAt).getTime() - Date.now()) / 1000;
        const clamped = Math.max(0, Math.ceil(remaining));
        setSecondsLeft(clamped);
        if (clamped <= 0) setPhase('answering');
      } else {
        setSecondsLeft((s) => {
          if (s <= 1) { setPhase('answering'); return 0; }
          return s - 1;
        });
      }
    }

    tick();
    const id = setInterval(tick, countdownStartAt ? 100 : 1000);
    return () => clearInterval(id);
  }, [countdownStartAt]);

  const progress = secondsLeft / COUNTDOWN_SECONDS;
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div className="fixed inset-0 bg-[#0b0f14] flex flex-col items-center justify-center gap-8 z-50">
      {/* Background glows */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[120px]" style={{ background: '#3b82f6', opacity: 0.12 }} />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full blur-[120px]" style={{ background: '#ec4899', opacity: 0.08 }} />

      <p className="relative text-sm font-bold uppercase tracking-[3px] text-[#6b7280]">Get Ready</p>

      {/* Progress ring + number */}
      <div className="relative flex items-center justify-center">
        <svg width="200" height="200" className="-rotate-90">
          {/* Track */}
          <circle
            cx="100" cy="100" r={RADIUS}
            fill="none"
            stroke="#263244"
            strokeWidth="6"
          />
          {/* Progress */}
          <circle
            cx="100" cy="100" r={RADIUS}
            fill="none"
            stroke="url(#countdownGradient)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.1s linear' }}
          />
          <defs>
            <linearGradient id="countdownGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
          </defs>
        </svg>

        <span
          className="absolute font-black text-[#e5e7eb] tabular-nums"
          style={{ fontSize: 72, lineHeight: 1, letterSpacing: '-4px' }}
        >
          {secondsLeft}
        </span>
      </div>

      <p className="relative text-base font-medium text-[#9ca3af]">
        Round 1 is starting…
      </p>

      <style>{`
        @keyframes pulseRing {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

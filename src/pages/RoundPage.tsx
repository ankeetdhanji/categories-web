import { useState } from 'react';
import { useGame } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api } from '../services/api';
import { HubEvents } from '../services/signalr';

interface RoundData {
  letter: string;
  categories: string[];
  durationSeconds: number;
}

export default function RoundPage() {
  const { gameId, playerId, setPhase } = useGame();
  const [round, setRound] = useState<RoundData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useSignalREvent(HubEvents.RoundStarted, (payload) => {
    const data = payload as RoundData;
    setRound(data);
    setAnswers({});
  });

  useSignalREvent(HubEvents.RoundEnded, () => {
    setPhase('results');
  });

  async function handleSubmit() {
    if (!gameId || !playerId) return;
    await api.submitAnswers(gameId, playerId, answers);
  }

  if (!round) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-[var(--color-text-muted)]">Waiting for round to start…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 min-h-screen max-w-lg mx-auto">
      <div className="flex items-center justify-between">
        <div className="text-6xl font-black text-[var(--color-neon-primary)]">{round.letter}</div>
        {/* TODO: countdown timer component */}
      </div>

      <div className="flex flex-col gap-3">
        {round.categories.map((category) => (
          <div key={category} className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--color-text-muted)]">{category}</label>
            <input
              className="input"
              placeholder={`${category} starting with ${round.letter}…`}
              value={answers[category] ?? ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [category]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <button onClick={handleSubmit} className="btn-primary mt-auto">
        Done
      </button>
    </div>
  );
}

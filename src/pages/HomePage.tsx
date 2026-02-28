import { useState } from 'react';
import { api } from '../services/api';
import { useGame } from '../context/GameContext';

export default function HomePage() {
  const { setGameId, setJoinCode, setPlayer, setHost, setPhase } = useGame();
  const [displayName, setDisplayName] = useState('');
  const [joinCode, setJoinCodeInput] = useState('');
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home');

  async function handleCreate() {
    const playerId = crypto.randomUUID();
    const { id, joinCode: code } = await api.createGame(playerId, displayName);
    setPlayer(playerId, displayName);
    setGameId(id);
    setJoinCode(code);
    setHost(true);
    setPhase('lobby');
  }

  async function handleJoin() {
    const playerId = crypto.randomUUID();
    const { id } = await api.joinGame(joinCode.toUpperCase(), playerId, displayName);
    setPlayer(playerId, displayName);
    setGameId(id);
    setJoinCode(joinCode.toUpperCase());
    setHost(false);
    setPhase('lobby');
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
      <h1 className="text-5xl font-bold tracking-tight">Categories</h1>
      <p className="text-[var(--color-text-muted)] text-center max-w-sm">
        A fast, real-time multiplayer word game for friends.
      </p>

      {mode === 'home' && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <button onClick={() => setMode('create')} className="btn-primary">Create Game</button>
          <button onClick={() => setMode('join')} className="btn-secondary">Join Game</button>
        </div>
      )}

      {mode === 'create' && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <input
            placeholder="Your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input"
          />
          <button onClick={handleCreate} disabled={!displayName.trim()} className="btn-primary">
            Create
          </button>
          <button onClick={() => setMode('home')} className="btn-ghost">Back</button>
        </div>
      )}

      {mode === 'join' && (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <input
            placeholder="Your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input"
          />
          <input
            placeholder="Game code"
            value={joinCode}
            onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
            maxLength={6}
            className="input uppercase tracking-widest text-center"
          />
          <button onClick={handleJoin} disabled={!displayName.trim() || joinCode.length < 6} className="btn-primary">
            Join
          </button>
          <button onClick={() => setMode('home')} className="btn-ghost">Back</button>
        </div>
      )}
    </div>
  );
}

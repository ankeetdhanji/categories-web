import { useGame } from '../context/GameContext';
import { useSignalREvent } from '../hooks/useSignalR';
import { api } from '../services/api';
import { HubEvents } from '../services/signalr';

export default function LobbyPage() {
  const { gameId, joinCode, playerId, isHost, setPhase } = useGame();

  // TODO: load full player list from server on mount + keep in state
  useSignalREvent(HubEvents.PlayerJoined, (payload) => {
    console.log('Player joined', payload);
    // TODO: update players list in state
  });

  useSignalREvent(HubEvents.PlayerLeft, (payload) => {
    console.log('Player left', payload);
    // TODO: update players list in state
  });

  useSignalREvent(HubEvents.GameCountdown, () => {
    setPhase('countdown');
  });

  async function handleStart() {
    if (!gameId || !playerId) return;
    await api.startGame(gameId, playerId);
  }

  return (
    <div className="flex flex-col items-center gap-8 p-6 min-h-screen">
      <h2 className="text-3xl font-bold">Lobby</h2>
      <div className="text-center">
        <p className="text-[var(--color-text-muted)] text-sm">Share this code</p>
        <p className="text-4xl font-mono font-bold tracking-widest">{joinCode}</p>
      </div>

      {/* TODO: render player list from state */}
      <div className="w-full max-w-sm flex-1">
        <h3 className="text-lg font-semibold mb-3">Players</h3>
        <p className="text-[var(--color-text-muted)] text-sm">Waiting for players to join…</p>
      </div>

      {isHost && (
        <button onClick={handleStart} className="btn-primary w-full max-w-sm">
          Start Game
        </button>
      )}
    </div>
  );
}

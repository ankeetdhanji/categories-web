import { useEffect, useRef } from 'react';
import { GameProvider, useGame, type GamePhase } from './context/GameContext';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import RoundPage from './pages/RoundPage';
import ReviewPage from './pages/ReviewPage';
import GameOverPage from './pages/GameOverPage';
import { useConnectionStatus } from './hooks/useConnectionStatus';
import { useSignalREvent } from './hooks/useSignalR';
import { HubEvents } from './services/signalr';
import { api } from './services/api';

// GameStatus integer → frontend phase
const STATUS_TO_PHASE: Record<number, GamePhase> = {
  0: 'lobby',      // Lobby
  1: 'countdown',  // Starting
  2: 'answering',  // InRound
  3: 'results',    // RoundResults
  4: 'results',    // Disputes
  5: 'results',    // BestAnswerVoting
  6: 'results',    // Leaderboard
  7: 'gameOver',   // Finished
};

function GameRouter() {
  const { phase } = useGame();

  switch (phase) {
    case 'home':      return <HomePage />;
    case 'lobby':     return <LobbyPage />;
    case 'countdown':
    case 'answering': return <RoundPage />;
    case 'results':   return <ReviewPage />;
    case 'gameOver':  return <GameOverPage />;
    default:          return <HomePage />;
  }
}

// Handles global SignalR events that must fire regardless of which page is active.
function GlobalSignalRHandlers() {
  const { playerId, players, setPlayers, setHost, removePlayer } = useGame();

  useSignalREvent(HubEvents.PlayerLeft, (data) => {
    removePlayer((data as { playerId: string }).playerId);
  });

  useSignalREvent(HubEvents.HostChanged, (data) => {
    const { hostPlayerId: newHostId } = data as { hostPlayerId: string };
    setPlayers(players.map((p) => ({ ...p, isHost: p.id === newHostId })));
    setHost(playerId === newHostId);
  });

  return null;
}

function ReconnectBanner() {
  const { gameId, phase, setPhase, setPlayers, setFullSettings, setCurrentRound } = useGame();
  const { isReconnecting } = useConnectionStatus();
  const wasReconnecting = useRef(false);

  useEffect(() => {
    const justReconnected = !isReconnecting && wasReconnecting.current;
    wasReconnecting.current = isReconnecting;

    if (!justReconnected || !gameId || phase === 'home') return;

    api.getGame(gameId).then((game) => {
      setPlayers(
        game.players.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          isHost: p.id === game.hostPlayerId,
          isGuest: p.isGuest,
          totalScore: p.totalScore,
          isSpectating: p.isSpectating,
        })),
      );
      setFullSettings(game.settings);

      const targetPhase = STATUS_TO_PHASE[game.status] ?? 'home';
      if (targetPhase !== phase) setPhase(targetPhase);

      // Resync current round info if in an active round
      if (game.status === 2 && game.currentRoundIndex >= 0) {
        const r = game.rounds[game.currentRoundIndex];
        if (r) {
          setCurrentRound({
            roundNumber: r.roundNumber,
            letter: r.letter,
            categories: r.categories,
            startedAt: r.startedAt,
            endsAt: r.endedAt,
          });
        }
      }
    }).catch(console.error);
  }, [isReconnecting]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isReconnecting) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 py-2"
      style={{ background: '#1e293b', borderBottom: '1px solid #334155' }}
    >
      <span className="inline-block w-3 h-3 rounded-full border-2 border-[#f59e0b] border-t-transparent animate-spin" />
      <span className="text-xs font-medium" style={{ color: '#f59e0b' }}>Reconnecting…</span>
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <GlobalSignalRHandlers />
      <ReconnectBanner />
      <GameRouter />
    </GameProvider>
  );
}

import { useEffect, useRef } from 'react';
import { GameProvider, useGame, type GamePhase } from './context/GameContext';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import RoundPage from './pages/RoundPage';
import ReviewPage from './pages/ReviewPage';
import GameOverPage from './pages/GameOverPage';
import { useConnectionStatus } from './hooks/useConnectionStatus';
import { useSignalREvent } from './hooks/useSignalR';
import { HubEvents, joinGameGroup } from './services/signalr';
import { api } from './services/api';
import { ErrorBoundary } from './components/ErrorBoundary';

// GameStatus integer → frontend phase
export const STATUS_TO_PHASE: Record<number, GamePhase> = {
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

function useSyncGameState() {
  const {
    gameId, playerId, phase,
    setPhase, setPlayers, setFullSettings,
    setCurrentRound, clearSubmittedPlayers, addSubmittedPlayer,
    setIsAwaitingHost,
  } = useGame();

  return async function syncGameState({ rejoinGroup = false } = {}) {
    if (!gameId || phase === 'home') return;
    try {
      const game = await api.getGame(gameId);
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
      const isAwaitingHost = (game as { isAwaitingHost?: boolean }).isAwaitingHost ?? false;
      setIsAwaitingHost(isAwaitingHost);
      const targetPhase = STATUS_TO_PHASE[game.status] ?? 'home';
      if (targetPhase !== phase) setPhase(targetPhase);
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
          const submitted = Object.entries(r.answers ?? {})
            .filter(([, a]) => a.isSubmitted)
            .map(([id]) => id);
          const done = r.donePlayerIds ?? [];
          clearSubmittedPlayers();
          [...new Set([...submitted, ...done])].forEach(addSubmittedPlayer);
        }
      }
      if (rejoinGroup && playerId) {
        joinGameGroup(gameId, playerId).catch(console.error);
      }
    } catch (e) {
      console.error('[syncGameState] failed', e);
    }
  };
}

// Handles global SignalR events that must fire regardless of which page is active.
function GlobalSignalRHandlers() {
  const { playerId, players, phase, gameId, setPlayers, setHost, removePlayer, returnToLobby, setIsAwaitingHost } = useGame();
  const syncGameState = useSyncGameState();

  useSignalREvent(HubEvents.PlayerLeft, (data) => {
    removePlayer((data as { playerId: string }).playerId);
  });

  useSignalREvent(HubEvents.HostChanged, (data) => {
    const { hostPlayerId: newHostId } = data as { hostPlayerId: string };
    setPlayers(players.map((p) => ({ ...p, isHost: p.id === newHostId })));
    setHost(playerId === newHostId);
    setIsAwaitingHost(false);
  });

  useSignalREvent(HubEvents.LobbyReopened, (data) => {
    if (!gameId || phase === 'home') return; // player already left via "Play Again"
    const { hostPlayerId, awaitingHost, hostAwaitDeadline, players: raw } = data as {
      hostPlayerId: string;
      awaitingHost: boolean;
      hostAwaitDeadline: string | null;
      players: Array<{ id: string; displayName: string; isHost: boolean; isGuest: boolean; isSpectating: boolean; totalScore: number }>;
    };

    const mappedPlayers = raw.map(p => ({
      id: p.id,
      displayName: p.displayName,
      isHost: p.isHost,
      isGuest: p.isGuest,
      isSpectating: p.isSpectating,
      totalScore: p.totalScore,
    }));

    returnToLobby(hostPlayerId, mappedPlayers, awaitingHost, hostAwaitDeadline ?? null);
  });

  useSignalREvent(HubEvents.GameStateSync, () => {
    syncGameState();
  });

  return null;
}

function ReconnectBanner() {
  const { gameId, phase } = useGame();
  const { isReconnecting } = useConnectionStatus();
  const wasReconnecting = useRef(false);
  const syncGameState = useSyncGameState();

  useEffect(() => {
    const justReconnected = !isReconnecting && wasReconnecting.current;
    wasReconnecting.current = isReconnecting;

    if (!justReconnected || !gameId || phase === 'home') return;

    syncGameState({ rejoinGroup: true });
  }, [isReconnecting]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isReconnecting) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 py-2"
      style={{ background: '#1e293b', borderBottom: '1px solid #334155', paddingTop: 'env(safe-area-inset-top)' }}
    >
      <span className="inline-block w-3 h-3 rounded-full border-2 border-[#f59e0b] border-t-transparent animate-spin" />
      <span className="text-xs font-medium" style={{ color: '#f59e0b' }}>Reconnecting…</span>
    </div>
  );
}

function DisconnectedBanner() {
  const { isDisconnected } = useConnectionStatus();

  if (!isDisconnected) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 px-6"
      style={{ background: 'rgba(11,15,20,0.97)' }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="font-bold text-base" style={{ color: '#ef4444' }}>
          Connection lost
        </span>
        <span className="text-sm max-w-sm" style={{ color: '#9ca3af' }}>
          Your connection to the game server was lost.
        </span>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="px-6 py-2.5 rounded-xl font-bold text-sm"
        style={{ background: '#3b82f6', color: '#0b0f14' }}
      >
        Tap to reload
      </button>
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <GlobalSignalRHandlers />
      <ReconnectBanner />
      <DisconnectedBanner />
      <ErrorBoundary>
        <GameRouter />
      </ErrorBoundary>
    </GameProvider>
  );
}

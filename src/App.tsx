import { GameProvider, useGame } from './context/GameContext';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import RoundPage from './pages/RoundPage';

function GameRouter() {
  const { phase } = useGame();

  switch (phase) {
    case 'home':      return <HomePage />;
    case 'lobby':     return <LobbyPage />;
    case 'countdown': return <div className="flex items-center justify-center min-h-screen text-6xl font-black">Get Ready!</div>;
    case 'answering': return <RoundPage />;
    // TODO: results, disputes, bestAnswerVoting, leaderboard, gameOver pages
    default:          return <HomePage />;
  }
}

export default function App() {
  return (
    <GameProvider>
      <GameRouter />
    </GameProvider>
  );
}

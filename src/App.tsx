import { GameProvider, useGame } from './context/GameContext';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import RoundPage from './pages/RoundPage';
import ReviewPage from './pages/ReviewPage';

function GameRouter() {
  const { phase } = useGame();

  switch (phase) {
    case 'home':      return <HomePage />;
    case 'lobby':     return <LobbyPage />;
    case 'countdown':
    case 'answering': return <RoundPage />;
    case 'results':   return <ReviewPage />;
    // TODO: leaderboard (KAN-27), gameOver pages
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

import { GameProvider, useGame } from './context/GameContext';
import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import RoundPage from './pages/RoundPage';
import ReviewPage from './pages/ReviewPage';
import GameOverPage from './pages/GameOverPage';

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

export default function App() {
  return (
    <GameProvider>
      <GameRouter />
    </GameProvider>
  );
}

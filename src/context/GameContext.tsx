import { createContext, useContext, useState, type ReactNode } from 'react';

export type GamePhase =
  | 'home'
  | 'lobby'
  | 'countdown'
  | 'answering'
  | 'results'
  | 'disputes'
  | 'bestAnswerVoting'
  | 'leaderboard'
  | 'gameOver';

export interface Player {
  id: string;
  displayName: string;
  isHost: boolean;
  isGuest: boolean;
  totalScore: number;
}

export interface RoundInfo {
  roundNumber: number;
  letter: string;
  categories: string[];
  startedAt: string | null;
  endsAt: string | null;
}

interface GameState {
  gameId: string | null;
  joinCode: string | null;
  playerId: string | null;
  displayName: string | null;
  isHost: boolean;
  phase: GamePhase;
  players: Player[];
  countdownStartAt: string | null;
  countdownLetter: string | null;
  countdownRoundNumber: number | null;
  currentRound: RoundInfo | null;
}

interface GameContextValue extends GameState {
  setGameId: (id: string) => void;
  setJoinCode: (code: string) => void;
  setPlayer: (id: string, name: string) => void;
  setHost: (isHost: boolean) => void;
  setPhase: (phase: GamePhase) => void;
  setPlayers: (players: Player[]) => void;
  addPlayer: (player: Player) => void;
  removePlayer: (playerId: string) => void;
  setCountdownStartAt: (startAt: string) => void;
  setCountdownInfo: (letter: string, roundNumber: number) => void;
  setCurrentRound: (round: RoundInfo) => void;
  reset: () => void;
}

const initialState: GameState = {
  gameId: null,
  joinCode: null,
  playerId: null,
  displayName: null,
  isHost: false,
  phase: 'home',
  players: [],
  countdownStartAt: null,
  countdownLetter: null,
  countdownRoundNumber: null,
  currentRound: null,
};

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GameState>(initialState);

  const ctx: GameContextValue = {
    ...state,
    setGameId: (gameId) => setState((s) => ({ ...s, gameId })),
    setJoinCode: (joinCode) => setState((s) => ({ ...s, joinCode })),
    setPlayer: (playerId, displayName) => setState((s) => ({ ...s, playerId, displayName })),
    setHost: (isHost) => setState((s) => ({ ...s, isHost })),
    setPhase: (phase) => setState((s) => ({ ...s, phase })),
    setPlayers: (players) => setState((s) => ({ ...s, players })),
    addPlayer: (player) => setState((s) => ({
      ...s,
      players: s.players.some((p) => p.id === player.id) ? s.players : [...s.players, player],
    })),
    removePlayer: (playerId) => setState((s) => ({
      ...s,
      players: s.players.filter((p) => p.id !== playerId),
    })),
    setCountdownStartAt: (countdownStartAt) => setState((s) => ({ ...s, countdownStartAt })),
    setCountdownInfo: (countdownLetter, countdownRoundNumber) => setState((s) => ({ ...s, countdownLetter, countdownRoundNumber })),
    setCurrentRound: (currentRound) => setState((s) => ({ ...s, currentRound })),
    reset: () => setState(initialState),
  };

  return <GameContext.Provider value={ctx}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}

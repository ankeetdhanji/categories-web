import { createContext, useContext, useState, type ReactNode } from 'react';
import type { GameSettings, LeaderboardEntry, FinalLeaderboardEntry } from '../services/api';

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
  isTimedMode: boolean;
  maxRounds: number;
  settings: GameSettings | null;
  submittedPlayerIds: string[];
  leaderboard: LeaderboardEntry[];
  reviewRoundNumber: number | null;
  finalWinnerIds: string[];
  bonusPerWinner: number;
  finalLeaderboard: FinalLeaderboardEntry[];
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
  setFullSettings: (settings: GameSettings) => void;
  addSubmittedPlayer: (playerId: string) => void;
  clearSubmittedPlayers: () => void;
  setLeaderboard: (entries: LeaderboardEntry[]) => void;
  setReviewRoundNumber: (n: number) => void;
  setFinalResult: (winnerIds: string[], bonus: number, finalLeaderboard: FinalLeaderboardEntry[]) => void;
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
  isTimedMode: true,
  maxRounds: 5,
  settings: null,
  submittedPlayerIds: [],
  leaderboard: [],
  reviewRoundNumber: null,
  finalWinnerIds: [],
  bonusPerWinner: 0,
  finalLeaderboard: [],
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
    setFullSettings: (s) => setState((prev) => ({ ...prev, settings: s, isTimedMode: s.isTimedMode, maxRounds: s.maxRounds })),
    addSubmittedPlayer: (playerId) => setState((s) => ({
      ...s,
      submittedPlayerIds: s.submittedPlayerIds.includes(playerId)
        ? s.submittedPlayerIds
        : [...s.submittedPlayerIds, playerId],
    })),
    clearSubmittedPlayers: () => setState((s) => ({ ...s, submittedPlayerIds: [] })),
    setLeaderboard: (leaderboard) => setState((s) => ({ ...s, leaderboard })),
    setReviewRoundNumber: (reviewRoundNumber) => setState((s) => ({ ...s, reviewRoundNumber })),
    setFinalResult: (finalWinnerIds, bonusPerWinner, finalLeaderboard) => setState((s) => ({ ...s, finalWinnerIds, bonusPerWinner, finalLeaderboard })),
    reset: () => setState(initialState),
  };

  return <GameContext.Provider value={ctx}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface GameSettings {
  isTimedMode: boolean;
  roundDurationSeconds: number;
  maxRounds: number;
  maxPlayers: number;
  uniqueAnswerPoints: number;
  sharedAnswerPoints: number;
  bestAnswerBonusPoints: number;
  disputeVotingWindowSeconds: number;
  categories: string[];
}

export interface PlayerRef {
  id: string;
  displayName: string;
}

export interface AnswerEntry {
  rawAnswer: string;
  normalizedAnswer: string;
  players: PlayerRef[];
  isShared: boolean;
  isUnique: boolean;
  isDisputed: boolean;
  disputeId: string | null;
}

export interface CategoryReview {
  name: string;
  entries: AnswerEntry[];
}

export interface RoundReviewResult {
  roundNumber: number;
  letter: string;
  categories: CategoryReview[];
}

export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  totalScore: number;
  roundScore: number;
}

export const api = {
  createGame: (hostPlayerId: string, displayName: string) =>
    request<{ gameId: string; joinCode: string; settings: GameSettings }>('/api/games', {
      method: 'POST',
      body: JSON.stringify({ hostPlayerId, displayName }),
    }),

  joinGame: (joinCode: string, playerId: string, displayName: string) =>
    request<{
      gameId: string;
      players: { id: string; displayName: string; isGuest: boolean; totalScore: number }[];
      settings: GameSettings;
    }>(`/api/games/${joinCode}/join`, {
      method: 'POST',
      body: JSON.stringify({ playerId, displayName }),
    }),

  startGame: (gameId: string, playerId: string) =>
    request<void>(`/api/games/${gameId}/start`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    }),

  getGame: (gameId: string) =>
    request<{
      id: string;
      joinCode: string;
      hostPlayerId: string;
      players: { id: string; displayName: string; isGuest: boolean; totalScore: number }[];
    }>(`/api/games/${gameId}`),

  submitAnswers: (gameId: string, playerId: string, answers: Record<string, string>) =>
    request<void>(`/api/games/${gameId}/rounds/current/answers`, {
      method: 'POST',
      body: JSON.stringify({ playerId, answers }),
    }),

  forceEndRound: (gameId: string, playerId: string) =>
    request<void>(`/api/games/${gameId}/rounds/current/end`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    }),

  getRoundResults: (gameId: string, roundNumber: number) =>
    request<RoundReviewResult>(`/api/games/${gameId}/rounds/${roundNumber}/results`),

  castDisputeVote: (gameId: string, roundNumber: number, disputeId: string, playerId: string, isValid: boolean) =>
    request<{ voteCount: number; totalVoters: number; resolved: boolean; isValid: boolean }>(
      `/api/games/${gameId}/rounds/${roundNumber}/disputes/${encodeURIComponent(disputeId)}/vote`,
      { method: 'POST', body: JSON.stringify({ playerId, isValid }) },
    ),

  likeAnswer: (gameId: string, roundNumber: number, playerId: string, category: string, normalizedAnswer: string) =>
    request<void>(`/api/games/${gameId}/rounds/${roundNumber}/likes`, {
      method: 'POST',
      body: JSON.stringify({ playerId, category, normalizedAnswer }),
    }),

  advanceCategory: (gameId: string, playerId: string, currentCategoryIndex: number) =>
    request<{ categoryIndex: number; isLastCategory: boolean }>(
      `/api/games/${gameId}/rounds/current/review/advance`,
      { method: 'POST', body: JSON.stringify({ playerId, currentCategoryIndex }) },
    ),
};

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

export interface FinalLeaderboardEntry {
  playerId: string;
  displayName: string;
  totalScore: number;
  bestAnswerVotes: number;
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
      players: { id: string; displayName: string; isGuest: boolean; totalScore: number; isSpectating?: boolean }[];
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
      /** Integer value of GameStatus enum: 0=Lobby 1=Starting 2=InRound 3=RoundResults 4=Disputes 5=BestAnswerVoting 6=Leaderboard 7=Finished */
      status: number;
      currentRoundIndex: number;
      players: { id: string; displayName: string; isGuest: boolean; totalScore: number; isSpectating?: boolean }[];
      settings: GameSettings;
      rounds: {
        roundNumber: number;
        letter: string;
        categories: string[];
        startedAt: string | null;
        endedAt: string | null;
      }[];
    }>(`/api/games/${gameId}`),

  submitAnswers: (gameId: string, playerId: string, answers: Record<string, string>) =>
    request<void>(`/api/games/${gameId}/rounds/current/answers`, {
      method: 'POST',
      body: JSON.stringify({ playerId, answers }),
    }),

  markDone: (gameId: string, playerId: string) =>
    request<void>(`/api/games/${gameId}/rounds/current/done`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
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

  updateSettings: (gameId: string, playerId: string, settings: GameSettings) =>
    request<void>(`/api/games/${gameId}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ playerId, settings }),
    }),

  finalizeGame: (gameId: string, playerId: string) =>
    request<{ winnerPlayerIds: string[]; bonusPerWinner: number; leaderboard: FinalLeaderboardEntry[] }>(
      `/api/games/${gameId}/finalize`,
      { method: 'POST', body: JSON.stringify({ playerId }) },
    ),

  getDefaultCategories: () =>
    request<{ categories: string[] }>('/api/categories/defaults'),

  getSavedCategories: (playerId: string) =>
    request<{ categories: string[] }>(`/api/users/${playerId}/categories`),

  saveMyCategories: (playerId: string, categories: string[]) =>
    request<void>(`/api/users/${playerId}/categories`, {
      method: 'PUT',
      body: JSON.stringify({ categories }),
    }),
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        !(err instanceof Error && err.message.startsWith('API error 4'));
      if (!isRetryable || attempt === maxAttempts - 1) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastErr;
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

export interface MergeGroup {
  id: string;
  category: string;
  canonicalAnswer: string;
  mergedNormalizedAnswers: string[];
  players?: PlayerRef[];
}

export interface AnswerEntry {
  rawAnswer: string;
  normalizedAnswer: string;
  players: PlayerRef[];
  isShared: boolean;
  isUnique: boolean;
  isDisputed: boolean;
  disputeId: string | null;
  isRejected?: boolean;
  isMerged?: boolean;
  mergeGroupId?: string;
  mergeCanonicalAnswer?: string;
  mergeVariants?: string[];
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
        status?: number;
        donePlayerIds?: string[];
        answers?: Record<string, { isSubmitted: boolean }>;
        currentCategoryIndex?: number;
      }[];
    }>(`/api/games/${gameId}`),

  submitAnswers: (gameId: string, playerId: string, answers: Record<string, string>) =>
    withRetry(() => request<void>(`/api/games/${gameId}/rounds/current/answers`, {
      method: 'POST',
      body: JSON.stringify({ playerId, answers }),
    })),

  markDone: (gameId: string, playerId: string) =>
    withRetry(() => request<void>(`/api/games/${gameId}/rounds/current/done`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    })),

  forceEndRound: (gameId: string, playerId: string) =>
    request<void>(`/api/games/${gameId}/rounds/current/end`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    }),

  getRoundResults: (gameId: string, roundNumber: number) =>
    request<RoundReviewResult>(`/api/games/${gameId}/rounds/${roundNumber}/results`),

  castDisputeVote: (gameId: string, roundNumber: number, disputeId: string, playerId: string, isValid: boolean) =>
    withRetry(() => request<{ voteCount: number; totalVoters: number; resolved: boolean; isValid: boolean }>(
      `/api/games/${gameId}/rounds/${roundNumber}/disputes/${encodeURIComponent(disputeId)}/vote`,
      { method: 'POST', body: JSON.stringify({ playerId, isValid }) },
    )),

  likeAnswer: (gameId: string, roundNumber: number, playerId: string, category: string, normalizedAnswer: string) =>
    withRetry(() => request<void>(`/api/games/${gameId}/rounds/${roundNumber}/likes`, {
      method: 'POST',
      body: JSON.stringify({ playerId, category, normalizedAnswer }),
    })),

  advanceCategory: (gameId: string, playerId: string, currentCategoryIndex: number) =>
    withRetry(() => request<{ categoryIndex: number; isLastCategory: boolean }>(
      `/api/games/${gameId}/rounds/current/review/advance`,
      { method: 'POST', body: JSON.stringify({ playerId, currentCategoryIndex }) },
    )),

  goBackCategory: (gameId: string, playerId: string) =>
    withRetry(() => request<{ categoryIndex: number }>(
      `/api/games/${gameId}/rounds/current/review/back`,
      { method: 'POST', body: JSON.stringify({ playerId }) },
    )),

  updateSettings: (gameId: string, playerId: string, settings: GameSettings) =>
    withRetry(() => request<void>(`/api/games/${gameId}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ playerId, settings }),
    })),

  finalizeGame: (gameId: string, playerId: string) =>
    withRetry(() => request<{ winnerPlayerIds: string[]; bonusPerWinner: number; leaderboard: FinalLeaderboardEntry[] }>(
      `/api/games/${gameId}/finalize`,
      { method: 'POST', body: JSON.stringify({ playerId }) },
    )),

  startNextRound: (gameId: string, playerId: string) =>
    withRetry(() => request<void>(`/api/games/${gameId}/rounds/next`, {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    })),

  rejectAnswer: (gameId: string, playerId: string, category: string, normalizedAnswer: string) =>
    request<void>(`/api/games/${gameId}/rounds/current/moderation/reject`, {
      method: 'POST',
      body: JSON.stringify({ playerId, category, normalizedAnswer }),
    }),

  unrejectAnswer: (gameId: string, playerId: string, category: string, normalizedAnswer: string) =>
    request<void>(`/api/games/${gameId}/rounds/current/moderation/reject`, {
      method: 'DELETE',
      body: JSON.stringify({ playerId, category, normalizedAnswer }),
    }),

  mergeAnswers: (gameId: string, playerId: string, category: string, normalizedAnswers: string[], canonicalAnswer: string) =>
    request<{ mergeGroupId: string }>(`/api/games/${gameId}/rounds/current/moderation/merge`, {
      method: 'POST',
      body: JSON.stringify({ playerId, category, normalizedAnswers, canonicalAnswer }),
    }),

  unmergeAnswers: (gameId: string, playerId: string, mergeGroupId: string) =>
    request<void>(`/api/games/${gameId}/rounds/current/moderation/merge/${mergeGroupId}`, {
      method: 'DELETE',
      body: JSON.stringify({ playerId }),
    }),

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

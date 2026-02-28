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

export const api = {
  createGame: (hostPlayerId: string, displayName: string) =>
    request<{ id: string; joinCode: string }>('/api/games', {
      method: 'POST',
      body: JSON.stringify({ hostPlayerId, displayName }),
    }),

  joinGame: (joinCode: string, playerId: string, displayName: string) =>
    request<{ id: string }>(`/api/games/${joinCode}/join`, {
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
};

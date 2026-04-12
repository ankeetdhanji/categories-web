import * as signalR from '@microsoft/signalr';

const HUB_URL = import.meta.env.VITE_SIGNALR_HUB_URL ?? 'http://localhost:5000/hubs/game';

let connection: signalR.HubConnection | null = null;
let connectingPromise: Promise<void> | null = null;

export function getConnection(): signalR.HubConnection {
  if (!connection) {
    connection = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL)
      .withAutomaticReconnect([0, 2000, 10000, 30000, 60000])
      .configureLogging(signalR.LogLevel.Information)
      .build();
  }
  return connection;
}

export async function startConnection(): Promise<void> {
  const conn = getConnection();
  if (conn.state === signalR.HubConnectionState.Connected) return;
  if (connectingPromise) return connectingPromise;
  connectingPromise = conn.start().finally(() => { connectingPromise = null; });
  return connectingPromise;
}

export async function joinGameGroup(gameId: string, playerId: string): Promise<void> {
  await getConnection().invoke('JoinGameGroup', gameId, playerId);
}

export async function leaveGameGroup(gameId: string): Promise<void> {
  await getConnection().invoke('LeaveGameGroup', gameId);
}

export async function sendReaction(gameId: string, emoji: string): Promise<void> {
  await getConnection().invoke('SendReaction', gameId, emoji);
}

export async function notifyAnswerPresence(gameId: string, playerId: string, category: string, hasAnswer: boolean): Promise<void> {
  await getConnection().invoke('NotifyAnswerPresence', gameId, playerId, category, hasAnswer);
}

// --- Event constants matching GameHubEvents on the server ---
export const HubEvents = {
  PlayerJoined: 'PlayerJoined',
  PlayerLeft: 'PlayerLeft',
  HostChanged: 'HostChanged',
  SettingsUpdated: 'SettingsUpdated',
  GameCountdown: 'GameCountdown',
  RoundStarted: 'RoundStarted',
  RoundEnded: 'RoundEnded',
  PhaseChanged: 'PhaseChanged',
  DisputeFlagged: 'DisputeFlagged',
  DisputeResolved: 'DisputeResolved',
  LeaderboardUpdated: 'LeaderboardUpdated',
  PlayerSubmitted: 'PlayerSubmitted',
  PlayerDone: 'PlayerDone',
  EmojiReaction: 'EmojiReaction',
  CategoryAdvanced: 'CategoryAdvanced',
  DisputeVoteUpdated: 'DisputeVoteUpdated',
  ReviewComplete: 'ReviewComplete',
  PlayerAnswerUpdated: 'PlayerAnswerUpdated',
  GameStateSync: 'GameStateSync',
} as const;

import * as signalR from '@microsoft/signalr';

const HUB_URL = import.meta.env.VITE_SIGNALR_HUB_URL ?? 'http://localhost:5000/hubs/game';

let connection: signalR.HubConnection | null = null;

export function getConnection(): signalR.HubConnection {
  if (!connection) {
    connection = new signalR.HubConnectionBuilder()
      .withUrl(HUB_URL)
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Information)
      .build();
  }
  return connection;
}

export async function startConnection(): Promise<void> {
  const conn = getConnection();
  if (conn.state === signalR.HubConnectionState.Disconnected) {
    await conn.start();
  }
}

export async function joinGameGroup(gameId: string): Promise<void> {
  await getConnection().invoke('JoinGameGroup', gameId);
}

export async function leaveGameGroup(gameId: string): Promise<void> {
  await getConnection().invoke('LeaveGameGroup', gameId);
}

// --- Event constants matching GameHubEvents on the server ---
export const HubEvents = {
  PlayerJoined: 'PlayerJoined',
  PlayerLeft: 'PlayerLeft',
  SettingsUpdated: 'SettingsUpdated',
  GameCountdown: 'GameCountdown',
  RoundStarted: 'RoundStarted',
  RoundEnded: 'RoundEnded',
  PhaseChanged: 'PhaseChanged',
  DisputeFlagged: 'DisputeFlagged',
  DisputeResolved: 'DisputeResolved',
  LeaderboardUpdated: 'LeaderboardUpdated',
  EmojiReaction: 'EmojiReaction',
} as const;

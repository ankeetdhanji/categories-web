import { useEffect } from 'react';
import { getConnection, startConnection } from '../services/signalr';

type Handler = (...args: unknown[]) => void;

/**
 * Subscribes to a SignalR hub event for the lifetime of the component.
 * Starts the connection if it is not already running.
 */
export function useSignalREvent(event: string, handler: Handler): void {
  useEffect(() => {
    const conn = getConnection();
    startConnection().catch(console.error);
    conn.on(event, handler);
    return () => {
      conn.off(event, handler);
    };
  }, [event, handler]);
}

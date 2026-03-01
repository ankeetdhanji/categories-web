import { useEffect, useRef } from 'react';
import { getConnection, startConnection } from '../services/signalr';

type Handler = (...args: unknown[]) => void;

/**
 * Subscribes to a SignalR hub event for the lifetime of the component.
 * Starts the connection if it is not already running.
 *
 * Uses a ref to hold the latest handler so the SignalR registration is
 * stable across re-renders — prevents the brief unregistration window
 * that could cause events to be missed when the component re-renders
 * rapidly (e.g. countdown timer firing every 100ms).
 */
export function useSignalREvent(event: string, handler: Handler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const conn = getConnection();
    startConnection().catch(console.error);
    const stableHandler = (...args: unknown[]) => handlerRef.current(...args);
    conn.on(event, stableHandler);
    return () => {
      conn.off(event, stableHandler);
    };
  }, [event]); // stable: only re-subscribe if the event name itself changes
}

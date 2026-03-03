import { useState, useEffect } from 'react';
import * as signalR from '@microsoft/signalr';
import { getConnection } from '../services/signalr';

/**
 * Returns whether the SignalR connection is currently reconnecting.
 * Registers onreconnecting / onreconnected / onclose callbacks on the
 * shared singleton connection. Since SignalR doesn't support unregistering
 * these callbacks, we guard against double-registration with a module flag.
 */

let registered = false;
const listeners = new Set<(reconnecting: boolean) => void>();

function ensureRegistered() {
  if (registered) return;
  registered = true;
  const conn = getConnection();
  conn.onreconnecting(() => listeners.forEach((fn) => fn(true)));
  conn.onreconnected(() => listeners.forEach((fn) => fn(false)));
  conn.onclose(() => listeners.forEach((fn) => fn(false)));
}

export function useConnectionStatus(): { isReconnecting: boolean } {
  const conn = getConnection();
  const [isReconnecting, setIsReconnecting] = useState(
    conn.state === signalR.HubConnectionState.Reconnecting,
  );

  useEffect(() => {
    ensureRegistered();
    const handler = (reconnecting: boolean) => setIsReconnecting(reconnecting);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  return { isReconnecting };
}

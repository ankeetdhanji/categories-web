import { useState, useEffect } from 'react';
import * as signalR from '@microsoft/signalr';
import { getConnection } from '../services/signalr';

/**
 * Returns whether the SignalR connection is currently reconnecting or permanently disconnected.
 * Registers onreconnecting / onreconnected / onclose callbacks on the
 * shared singleton connection. Since SignalR doesn't support unregistering
 * these callbacks, we guard against double-registration with a module flag.
 */

let registered = false;
const reconnectingListeners = new Set<(v: boolean) => void>();
const disconnectedListeners = new Set<(v: boolean) => void>();

function ensureRegistered() {
  if (registered) return;
  registered = true;
  const conn = getConnection();
  conn.onreconnecting(() => {
    reconnectingListeners.forEach((fn) => fn(true));
    disconnectedListeners.forEach((fn) => fn(false));
  });
  conn.onreconnected(() => {
    reconnectingListeners.forEach((fn) => fn(false));
    disconnectedListeners.forEach((fn) => fn(false));
  });
  conn.onclose(() => {
    reconnectingListeners.forEach((fn) => fn(false));
    disconnectedListeners.forEach((fn) => fn(true));
  });
}

export function useConnectionStatus(): { isReconnecting: boolean; isDisconnected: boolean } {
  const conn = getConnection();
  const [isReconnecting, setIsReconnecting] = useState(
    conn.state === signalR.HubConnectionState.Reconnecting,
  );
  const [isDisconnected, setIsDisconnected] = useState(false);

  useEffect(() => {
    ensureRegistered();
    reconnectingListeners.add(setIsReconnecting);
    disconnectedListeners.add(setIsDisconnected);
    return () => {
      reconnectingListeners.delete(setIsReconnecting);
      disconnectedListeners.delete(setIsDisconnected);
    };
  }, []);

  return { isReconnecting, isDisconnected };
}

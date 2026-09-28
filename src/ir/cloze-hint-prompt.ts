const pendingByHost = new WeakMap<object, () => void>();

/** Resolves the existing hint prompt before its inline bar is replaced. */
export function cancelPendingClozeHint(host: object): void {
  pendingByHost.get(host)?.();
}

/** Registers a pending hint prompt and returns its cleanup callback. */
export function registerPendingClozeHint(
  host: object,
  cancel: () => void,
): () => void {
  pendingByHost.set(host, cancel);
  return () => {
    if (pendingByHost.get(host) === cancel) pendingByHost.delete(host);
  };
}

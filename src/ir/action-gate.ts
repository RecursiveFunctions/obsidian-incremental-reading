/** Drops reentrant actions rather than applying them to a later review card. */
export class DropWhileBusyGate {
  private busy = false;

  get isBusy(): boolean {
    return this.busy;
  }

  async run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (this.busy) return undefined;
    this.busy = true;
    try {
      return await action();
    } finally {
      this.busy = false;
    }
  }
}

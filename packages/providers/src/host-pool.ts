export type HostPool = ReturnType<typeof createHostPool>;

export function createHostPool(hosts: readonly string[], coolDownMs: number, now = Date.now) {
  const cooling = new Map<string, number>();

  return {
    order(): string[] {
      const at = now();
      const readyAt = (host: string) => Math.max(at, cooling.get(host) ?? at);
      return [...hosts].sort((a, b) => readyAt(a) - readyAt(b));
    },

    down(host: string): void {
      cooling.set(host, now() + coolDownMs);
    },

    up(host: string): void {
      cooling.delete(host);
    },
  };
}

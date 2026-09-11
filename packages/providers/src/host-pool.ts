export interface HostPool {
  order(): string[];
  down(host: string): void;
  up(host: string): void;
}

export function createHostPool(
  hosts: readonly string[],
  coolDownMs: number,
  now: () => number = Date.now,
): HostPool {
  const cooling = new Map<string, number>();

  return {
    order() {
      const at = now();
      const ready: string[] = [];
      const resting: string[] = [];

      for (const host of hosts) {
        const until = cooling.get(host);
        if (until === undefined || until <= at) {
          cooling.delete(host);
          ready.push(host);
        } else {
          resting.push(host);
        }
      }

      resting.sort((a, b) => cooling.get(a)! - cooling.get(b)!);
      return [...ready, ...resting];
    },

    down(host) {
      cooling.set(host, now() + coolDownMs);
    },

    up(host) {
      cooling.delete(host);
    },
  };
}

/*
 * Several hostnames for one API, and a short memory of which of them just failed.
 *
 * Written for Audius, whose `/v1` API answers on four hostnames and whose adapter used to
 * know one. The memory is the point rather than the list: without it every request pays for
 * a dead first host before reaching a live one, which turns an outage into a slowdown on
 * every search instead of on one.
 */

export interface HostPool {
  /** Every host, the ones not cooling down first. Order within each group is the listed
   * order, and the cooling ones follow soonest-recovered first — demoted, never dropped, so
   * a pool whose every host has failed still has somewhere to ask. */
  order(): string[];
  /** Sets a host aside for the cool-down. */
  down(host: string): void;
  /** Clears a host's cool-down: it answered, so the next caller may lead with it again. */
  up(host: string): void;
}

export function createHostPool(
  hosts: readonly string[],
  coolDownMs: number,
  now: () => number = Date.now,
): HostPool {
  /** Host → the moment it may lead again. Absent means healthy. */
  const cooling = new Map<string, number>();

  return {
    order() {
      const at = now();
      const ready: string[] = [];
      const resting: string[] = [];

      for (const host of hosts) {
        const until = cooling.get(host);
        if (until === undefined || until <= at) {
          // Expired entries are forgotten here rather than on a timer, so an idle
          // instance holds no clock and a busy one tidies as it goes.
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

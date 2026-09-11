import type { Song } from "../types";

export interface QueueEdit {
  queue: Song[];
  index: number;
  play: Song | null;
  stopped: boolean;
}

export function removeAt(queue: Song[], index: number, position: number): QueueEdit | null {
  const song = queue[position];
  if (!song) return null;

  const remaining = queue.filter((_, at) => at !== position);

  if (position > index) return { queue: remaining, index, play: null, stopped: false };

  if (position < index) return { queue: remaining, index: index - 1, play: null, stopped: false };

  if (remaining.length === 0) return { queue: remaining, index: 0, play: null, stopped: true };

  const at = Math.min(position, remaining.length - 1);
  return { queue: remaining, index: at, play: remaining[at]!, stopped: false };
}

export function insertAfter(queue: Song[], index: number, songs: Song[]): QueueEdit | null {
  if (songs.length === 0) return null;

  if (queue.length === 0) return { queue: songs, index: 0, play: songs[0]!, stopped: false };

  const at = Math.min(Math.max(index, 0), queue.length - 1) + 1;

  return {
    queue: [...queue.slice(0, at), ...songs, ...queue.slice(at)],
    index,
    play: null,
    stopped: false,
  };
}

export function moveWithin(queue: Song[], index: number, from: number, to: number): QueueEdit | null {
  const song = queue[from];
  if (!song || from === to || to < 0 || to >= queue.length) return null;

  const rest = queue.filter((_, at) => at !== from);
  const reordered = [...rest.slice(0, to), song, ...rest.slice(to)];

  let next = index;
  if (from === index) next = to;
  else if (from < index && to >= index) next = index - 1;
  else if (from > index && to <= index) next = index + 1;

  return { queue: reordered, index: next, play: null, stopped: false };
}

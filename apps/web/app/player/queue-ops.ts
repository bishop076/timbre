import type { Song } from "../types";

export interface QueueEdit {
  queue: Song[];
  index: number;
  play: Song | null;
}

export function removeAt(queue: Song[], index: number, position: number): QueueEdit | null {
  if (!queue[position]) return null;

  const remaining = queue.filter((_, at) => at !== position);
  if (position !== index) {
    return { queue: remaining, index: position < index ? index - 1 : index, play: null };
  }

  const at = Math.max(0, Math.min(position, remaining.length - 1));
  return { queue: remaining, index: at, play: remaining[at] ?? null };
}

export function insertAfter(queue: Song[], index: number, songs: Song[]): QueueEdit | null {
  if (songs.length === 0) return null;
  if (queue.length === 0) return { queue: songs, index: 0, play: songs[0] };

  const at = Math.min(Math.max(index, 0), queue.length - 1) + 1;
  return { queue: [...queue.slice(0, at), ...songs, ...queue.slice(at)], index, play: null };
}

export function moveWithin(queue: Song[], index: number, from: number, to: number): QueueEdit | null {
  const song = queue[from];
  if (!song || from === to || to < 0 || to >= queue.length) return null;

  const rest = queue.filter((_, at) => at !== from);
  let next = index;
  if (from === index) next = to;
  else if (from < index && to >= index) next = index - 1;
  else if (from > index && to <= index) next = index + 1;

  return { queue: [...rest.slice(0, to), song, ...rest.slice(to)], index: next, play: null };
}

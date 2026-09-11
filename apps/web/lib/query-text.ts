import { z } from "zod";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" ? value.trim() || undefined : value;

export const queryText = (max: number) => z.preprocess(blankToUndefined, z.string().max(max));

export const optionalQueryText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().max(max).optional());

export const queryFlag = z
  .enum(["1", "true", "0", "false"])
  .optional()
  .transform((value) => value === "1" || value === "true");

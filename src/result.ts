/**
 * Format de retour HOMOGENE pour tous les outils (exigence NF 6.2).
 * Sorties structurees, concises, avec statut + message actionnable.
 */

export type Status = "success" | "partial" | "error";

export interface ToolResult<T = unknown> {
  status: Status;
  /** Message court et ACTIONNABLE destine au LLM. */
  message: string;
  /** Donnees structurees specifiques a l'outil. */
  data?: T;
}

export function ok<T>(message: string, data?: T): ToolResult<T> {
  return { status: "success", message, data };
}

export function partial<T>(message: string, data?: T): ToolResult<T> {
  return { status: "partial", message, data };
}

export function err<T>(message: string, data?: T): ToolResult<T> {
  return { status: "error", message, data };
}

/** Erreur applicative portant deja un message actionnable. */
export class ToolError extends Error {
  readonly data?: unknown;
  constructor(message: string, data?: unknown) {
    super(message);
    this.name = "ToolError";
    this.data = data;
  }
}

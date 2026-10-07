/** Short, non-blocking tactile feedback for a completed check-in. */
export function hapticCheckIn(isLate = false): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(isLate ? [18, 36, 18] : 18);
}

/** A distinct double tick for a refused or invalid check-in. */
export function hapticCheckInError(): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate([12, 32, 12]);
}

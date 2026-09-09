export const maxCaptureTailPaddingMs = 1_000;

export function assertCaptureSourceDuration({
  declaredDurationMs,
  fps,
  observedDurationMs,
}: {
  declaredDurationMs: number;
  fps: number;
  observedDurationMs: number;
}) {
  const shortfallToleranceMs = Math.max(100, Math.ceil(2_000 / fps));
  if (observedDurationMs < declaredDurationMs - shortfallToleranceMs) {
    throw new Error('Capture source is shorter than its declared timeline');
  }
  if (observedDurationMs > declaredDurationMs + maxCaptureTailPaddingMs) {
    throw new Error(
      'Capture source tail padding exceeds its bounded tolerance',
    );
  }
}

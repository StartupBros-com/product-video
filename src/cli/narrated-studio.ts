import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { packageRoot, readJsonFile } from '../files';
import {
  assertRenderableNarratedCapture,
  parseNarratedCaptureBundle,
  parseNarratedTelemetry,
} from '../narrated-contracts';
import {
  assertNarratedFileSha256,
  assertNarratedPublicAsset,
  assertNarratedRunFile,
  assertSingleLinkRegularFile,
  getNarratedRunPaths,
} from '../narrated-files';
import {
  type NarratedResolvedManifest,
  parseNarratedResolvedManifest,
} from '../narrated-resolved-contracts';
import { assertTelemetryMatchesCapture } from '../narrated-telemetry';
import { assertNarratedManifestMatchesCapture } from '../narrated-verification';

const HELP = `Open Remotion Studio for a resolved NarratedBrowserTour v1 manifest without opening a browser window.

Usage:
  pnpm --filter @kit/product-video narrated:studio \\
    --manifest <public/generated/narrated/<run-id>/resolved.v1.json>

Studio previews the validated local composition only. It does not render, capture, upload, or publish.
`;

export function getNarratedStudioArguments(manifest: NarratedResolvedManifest) {
  return [
    'studio',
    path.join(packageRoot, 'src', 'index.ts'),
    '--no-open',
    '--props',
    JSON.stringify({ manifest }),
  ];
}

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', default: false, short: 'h' },
      manifest: { type: 'string' },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!values.manifest) {
    throw new Error('--manifest is required');
  }

  const manifestPath = path.resolve(values.manifest);
  await assertSingleLinkRegularFile(manifestPath);
  const manifest = parseNarratedResolvedManifest(
    await readJsonFile(manifestPath),
  );
  const runPaths = getNarratedRunPaths(manifest.runId);
  await assertNarratedRunFile(manifest.runId, manifestPath, 'resolved.v1.json');
  await assertNarratedRunFile(
    manifest.runId,
    runPaths.captureBundlePath,
    'capture.v1.json',
  );
  const [videoPath, telemetryPath, narrationPath] = await Promise.all([
    assertNarratedPublicAsset(manifest.runId, manifest.source.video),
    assertNarratedPublicAsset(manifest.runId, manifest.source.telemetry),
    assertNarratedPublicAsset(manifest.runId, manifest.narration.audio),
  ]);
  const capture = assertRenderableNarratedCapture(
    parseNarratedCaptureBundle(await readJsonFile(runPaths.captureBundlePath)),
  );
  const telemetry = parseNarratedTelemetry(await readJsonFile(telemetryPath));
  assertTelemetryMatchesCapture(telemetry, capture);
  assertNarratedManifestMatchesCapture(manifest, capture);
  await Promise.all([
    assertNarratedFileSha256(videoPath, manifest.source.videoSha256),
    assertNarratedFileSha256(telemetryPath, manifest.source.telemetrySha256),
    assertNarratedFileSha256(narrationPath, manifest.narration.audioSha256),
  ]);
  if (JSON.stringify(telemetry) !== JSON.stringify(manifest.telemetry)) {
    throw new Error(
      'Resolved manifest telemetry does not match the finalized telemetry file',
    );
  }

  const result = spawnSync('remotion', getNarratedStudioArguments(manifest), {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    const detail =
      result.error?.message ?? 'Remotion Studio exited unsuccessfully';
    throw new Error(detail);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

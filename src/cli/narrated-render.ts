import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
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
  getNarratedRenderPaths,
  getNarratedRunPaths,
  markNarratedRenderOutput,
  prepareNarratedRenderOutput,
  publishNarratedFileAtomically,
} from '../narrated-files';
import { parseNarratedResolvedManifest } from '../narrated-resolved-contracts';
import { assertTelemetryMatchesCapture } from '../narrated-telemetry';
import { assertNarratedManifestMatchesCapture } from '../narrated-verification';
import { firstAvailableBrowser } from '../rendering';

const HELP = `Render a resolved NarratedBrowserTour v1 manifest to its owned local H264 output.

Usage:
  pnpm --filter @kit/product-video narrated:render \\
    --manifest <public/generated/narrated/<run-id>/resolved.v1.json> \\
    [--browser-executable <path>] [--force]

Output is fixed to tooling/product-video/out/narrated/<run-id>/narrated-browser-tour.mp4.
--force replaces only a prior output proven to be owned by this renderer.
`;

async function main() {
  const { values } = parseArgs({
    options: {
      'browser-executable': { type: 'string' },
      force: { type: 'boolean', default: false },
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
  const renderPaths = await prepareNarratedRenderOutput(
    manifest.runId,
    values.force,
  );
  const temporaryOutputPath = path.join(
    renderPaths.outputDirectory,
    `.narrated-browser-tour.${randomUUID()}.mp4`,
  );
  const browserExecutable = await firstAvailableBrowser(
    values['browser-executable'],
  );

  try {
    const serveUrl = await bundle({
      entryPoint: path.join(packageRoot, 'src', 'index.ts'),
    });
    const inputProps = { manifest };
    const composition = await selectComposition({
      browserExecutable,
      id: 'NarratedBrowserTour',
      inputProps,
      serveUrl,
    });
    await renderMedia({
      browserExecutable,
      chromiumOptions: { enableMultiProcessOnLinux: true },
      codec: 'h264',
      composition,
      crf: 20,
      imageFormat: 'png',
      inputProps,
      logLevel: 'warn',
      outputLocation: temporaryOutputPath,
      overwrite: false,
      pixelFormat: 'yuv420p',
      serveUrl,
    });
    await publishNarratedFileAtomically(
      temporaryOutputPath,
      renderPaths.outputPath,
    );
    await markNarratedRenderOutput(renderPaths, manifest.runId);
  } catch (error) {
    await rm(temporaryOutputPath, { force: true });
    throw error;
  }

  process.stdout.write(
    `${JSON.stringify({
      browserExecutable,
      manifestPath,
      outputPath: getNarratedRenderPaths(manifest.runId).outputPath,
      runId: manifest.runId,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

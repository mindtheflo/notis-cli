import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function parseSemver(version) {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?$/.exec(version);
  if (!match?.groups) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  return {
    major: Number.parseInt(match.groups.major, 10),
    minor: Number.parseInt(match.groups.minor, 10),
    patch: Number.parseInt(match.groups.patch, 10),
  };
}

export function compareVersions(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);

  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

export function incrementPatchVersion(version) {
  const parsed = parseSemver(version);
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

export function computePrereleasePublishVersion({
  packageVersion,
  prereleaseTag,
  runNumber,
  runAttempt,
}) {
  parseSemver(packageVersion);

  if (!prereleaseTag) {
    throw new Error('prereleaseTag is required');
  }
  if (!runNumber) {
    throw new Error('runNumber is required for prerelease publishing');
  }

  const normalizedAttempt = runAttempt || '1';
  return `${packageVersion}-${prereleaseTag}.${runNumber}.${normalizedAttempt}`;
}

export function normalizeRegistryVersion(rawVersion) {
  if (!rawVersion) {
    return null;
  }

  if (Array.isArray(rawVersion)) {
    if (rawVersion.length === 0) {
      return null;
    }
    return String(rawVersion[rawVersion.length - 1]);
  }

  return String(rawVersion);
}

export function computePublishVersion({ packageVersion, latestRegistryVersion }) {
  const normalizedLatest = normalizeRegistryVersion(latestRegistryVersion);
  if (!normalizedLatest) {
    return packageVersion;
  }

  if (compareVersions(packageVersion, normalizedLatest) > 0) {
    return packageVersion;
  }

  return incrementPatchVersion(normalizedLatest);
}

export function readPackageManifest(cwd = process.cwd()) {
  const manifestPath = resolve(cwd, 'package.json');
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

export function fetchLatestRegistryVersion(packageName, { cwd = process.cwd(), env = process.env } = {}) {
  if (env.NPM_LATEST_VERSION_OVERRIDE) {
    return normalizeRegistryVersion(env.NPM_LATEST_VERSION_OVERRIDE);
  }

  const result = spawnSync('npm', ['view', packageName, 'version', '--json'], {
    cwd,
    env,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    return null;
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    return null;
  }

  return normalizeRegistryVersion(JSON.parse(stdout));
}

export function applyVersion(nextVersion, { cwd = process.cwd(), env = process.env } = {}) {
  const result = spawnSync(
    'npm',
    ['version', nextVersion, '--no-git-tag-version', '--allow-same-version'],
    {
      cwd,
      env,
      encoding: 'utf-8',
      stdio: 'pipe',
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `npm version ${nextVersion} failed`);
  }
}

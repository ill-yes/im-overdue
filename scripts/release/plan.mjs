const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sourceCommit = /^[0-9a-f]{40}$/;
const runId = /^[1-9]\d*$/;
const imageDigest = /^sha256:[0-9a-f]{64}$/;
const reservationSubject = /^im-overdue-release-v1 run=([1-9]\d*) base=(\S+)$/;
const bumps = ['major', 'minor', 'patch'];

export const BOOTSTRAP = Object.freeze({
  version: '1.0.0',
  sourceCommit: 'd3ab06007393955b72f5dba62343961a795487de',
  digest: 'sha256:75dda9b4334430d128f5b68585a81d1a099a93a936fda560c47388ff9368d628',
});

function matches(pattern, value) {
  return typeof value === 'string' && pattern.test(value);
}

export function parseVersionTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) return null;
  const version = tag.slice(1);
  return matches(stableVersion, version) ? version : null;
}

export function parseReservation(subject) {
  if (typeof subject !== 'string') return null;
  const match = reservationSubject.exec(subject);
  if (!match || !matches(stableVersion, match[2])) return null;
  return { runId: match[1], baseVersion: match[2] };
}

function versionParts(version) {
  return version.split('.').map(BigInt);
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

function bumpVersion(version, bump) {
  const index = bumps.indexOf(bump);
  const parts = versionParts(version);
  parts[index] += 1n;
  return parts.fill(0n, index + 1).join('.');
}

function validateRecord(record, label) {
  if (!matches(stableVersion, record.version) || !matches(sourceCommit, record.sourceCommit)) {
    throw new Error(`${label} must have a canonical stable version and full Git commit SHA.`);
  }
}

function indexSnapshot(snapshot) {
  const tags = new Map();
  const reservations = new Map();
  for (const tag of snapshot.tags) {
    validateRecord(tag, 'Git tag');
    if (tags.has(tag.version)) throw new Error(`Duplicate Git tag v${tag.version}.`);
    if (tag.reservation !== null) {
      const { runId: owner, baseVersion } = tag.reservation ?? {};
      if (!matches(runId, owner) || !matches(stableVersion, baseVersion)
        || !bumps.some((bump) => bumpVersion(baseVersion, bump) === tag.version)) {
        throw new Error(`Invalid release reservation on Git tag v${tag.version}.`);
      }
      if (reservations.has(owner)) throw new Error(`Multiple Git tags reserve release run ${owner}.`);
      reservations.set(owner, tag);
    }
    tags.set(tag.version, tag);
  }

  const releases = new Map();
  for (const release of snapshot.releases) {
    validateRecord(release, 'GitHub Release');
    const { version, digest } = release;
    if (digest !== undefined && !matches(imageDigest, digest)) {
      throw new Error(`GitHub Release v${version} has an invalid image digest.`);
    }
    if (releases.has(version)) throw new Error(`Duplicate GitHub Release v${version}.`);
    if (version === BOOTSTRAP.version) {
      if (release.sourceCommit !== BOOTSTRAP.sourceCommit || (digest !== undefined && digest !== BOOTSTRAP.digest)) {
        throw new Error(`GitHub Release v${version} conflicts with the bootstrap release.`);
      }
    } else if (tags.get(version)?.sourceCommit !== release.sourceCommit) {
      throw new Error(`GitHub Release v${version} requires a matching Git tag and source commit.`);
    }
    releases.set(version, release);
  }

  const bootstrapTag = tags.get(BOOTSTRAP.version);
  if (bootstrapTag && bootstrapTag.sourceCommit !== BOOTSTRAP.sourceCommit) {
    throw new Error(`Git tag v${BOOTSTRAP.version} conflicts with the bootstrap release.`);
  }
  releases.set(BOOTSTRAP.version, BOOTSTRAP);

  for (const version of releases.keys()) {
    const reservation = tags.get(version)?.reservation;
    if (reservation && !releases.has(reservation.baseVersion)) {
      throw new Error(`GitHub Release v${version} references an unpublished base v${reservation.baseVersion}.`);
    }
  }
  const versions = [...releases.keys()].sort((left, right) => compareVersions(right, left));
  return { tags, reservations, releases, versions };
}

export function releasedVersions(snapshot) {
  const { releases, versions } = indexSnapshot(snapshot);
  return versions.map((version) => releases.get(version));
}

function validateRequest(request) {
  if (!bumps.includes(request.bump) || !matches(sourceCommit, request.dispatchCommit)
    || !matches(runId, request.runId) || !Number.isSafeInteger(request.attempt) || request.attempt < 1) {
    throw new Error('Release request must have a valid bump, full Git commit SHA, run ID, and run attempt.');
  }
}

function pendingTag({ tags, releases, versions }) {
  const pending = [...tags.values()].filter((tag) => (
    !releases.has(tag.version) && compareVersions(tag.version, BOOTSTRAP.version) > 0
  ));
  if (pending.length > 1) throw new Error('Multiple pending stable release tags require manual resolution.');
  const [tag] = pending;
  if (tag && !tag.reservation) {
    throw new Error(`Pending Git tag v${tag.version} has no release reservation.`);
  }
  if (tag && tag.reservation.baseVersion !== versions[0]) {
    throw new Error(`Pending Git tag v${tag.version} has a stale base. Latest release is v${versions[0]}.`);
  }
  return tag;
}

function makePlan(mode, version, commit, base) {
  return { mode, version, sourceCommit: commit, baseVersion: base.version, baseSourceCommit: base.sourceCommit };
}

function completePlan(state, version) {
  const { tags, releases, versions } = state;
  const baseVersion = tags.get(version)?.reservation?.baseVersion ?? versions[versions.indexOf(version) + 1] ?? version;
  return makePlan('complete', version, releases.get(version).sourceCommit, releases.get(baseVersion));
}

function resolvePlan(state, request) {
  const { reservations, releases, versions } = state;
  const pending = pendingTag(state);
  const ownedVersion = reservations.get(request.runId)?.version;
  if (releases.has(ownedVersion)) return completePlan(state, ownedVersion);
  const matchingVersion = versions.find((version) => releases.get(version).sourceCommit === request.dispatchCommit);
  if (matchingVersion) return completePlan(state, matchingVersion);

  const base = releases.get(versions[0]);
  if (pending && (request.attempt === 1 || pending.reservation.runId === request.runId
    || pending.sourceCommit === request.dispatchCommit)) {
    return makePlan('resume', pending.version, pending.sourceCommit, base);
  }
  if (request.attempt > 1) {
    throw new Error('This run has no matching release or pending reservation. Start a fresh workflow dispatch.');
  }
  return makePlan('fresh', bumpVersion(base.version, request.bump), request.dispatchCommit, base);
}

export function resolveReleasePlan(snapshot, request) {
  validateRequest(request);
  return resolvePlan(indexSnapshot(snapshot), request);
}

function samePlanTarget(actual, expected) {
  return actual.version === expected.version && actual.sourceCommit === expected.sourceCommit
    && actual.baseVersion === expected.baseVersion && actual.baseSourceCommit === expected.baseSourceCommit;
}

export function assertPublishPlan(snapshot, request, expectedPlan) {
  validateRequest(request);
  if (!['fresh', 'resume', 'complete'].includes(expectedPlan.mode)) {
    throw new Error('Expected release plan must have a valid mode.');
  }
  const state = indexSnapshot(snapshot);
  const current = resolvePlan(state, { ...request, attempt: 1 });
  const reservation = state.tags.get(expectedPlan.version)?.reservation;
  if (expectedPlan.mode === 'resume' && !reservation) {
    throw new Error(`Expected release reservation for v${expectedPlan.version} is missing.`);
  }

  // A recovery dispatch may have finished another run's source commit. Match
  // the original plan directly before considering today's publish candidate.
  if (state.releases.get(expectedPlan.version)?.sourceCommit === expectedPlan.sourceCommit) {
    const completed = completePlan(state, expectedPlan.version);
    if (samePlanTarget(completed, expectedPlan)) return completed;
  }

  const modeMatches = current.mode === expectedPlan.mode || (expectedPlan.mode === 'fresh' && current.mode === 'resume');
  if (!modeMatches || !samePlanTarget(current, expectedPlan)) {
    throw new Error('Release plan changed since validation. Start a fresh workflow dispatch.');
  }
  return current;
}

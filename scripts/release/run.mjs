import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertPublishPlan, parseReservation, parseVersionTag, releasedVersions, resolveReleasePlan } from './plan.mjs';
import { assertReleaseImage, assertReleaseLicense, createRegistry } from './registry.mjs';

const repository = 'ill-yes/im-overdue';
const image = `ghcr.io/${repository}`;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

function checkedState(io, request, expected) {
  const snapshot = io.readSnapshot();
  const plan = expected
    ? assertPublishPlan(snapshot, request, expected)
    : resolveReleasePlan(snapshot, request);
  io.assertAncestry(plan);
  return { plan, releases: releasedVersions(snapshot) };
}

function assertSourceImage(io, info, release) {
  const license = io.readSourceLicense(release.sourceCommit);
  assertReleaseImage(info, { ...release, license });
}

async function publishedImage(io, release) {
  const info = await io.registry.inspect(release.version);
  if (!info) throw new Error(`Published image ${image}:${release.version} is missing.`);
  assertSourceImage(io, info, release);
  return info;
}

async function verifiedBaseline(io, state) {
  const base = state.releases.find(release => release.version === state.plan.baseVersion);
  if (!base) throw new Error(`Release baseline ${state.plan.baseVersion} is missing.`);
  return publishedImage(io, base);
}

async function verifyComplete(io, state) {
  const release = state.releases.find(item => item.version === state.plan.version);
  if (!release) throw new Error(`GitHub Release v${state.plan.version} is missing.`);
  return publishedImage(io, release);
}

async function channelsToPromote(io, state, targetDigest) {
  const channel = state.plan.version.split('.').slice(0, 2).join('.');
  const baseline = await verifiedBaseline(io, state);
  const previousChannel = state.releases.find(release => release.version.startsWith(`${channel}.`));
  const latest = await io.registry.inspect('latest');
  const minor = await io.registry.inspect(channel);

  if (!latest || (latest.digest !== targetDigest && latest.digest !== baseline.digest)) {
    throw new Error('The latest tag points outside the planned release history. Inspect GHCR before resuming.');
  }
  if (minor && minor.digest !== targetDigest) {
    if (!previousChannel) throw new Error(`The ${channel} tag is already occupied.`);
    const previous = previousChannel.version === state.plan.baseVersion
      ? baseline
      : await publishedImage(io, previousChannel);
    if (minor.digest !== previous.digest) throw new Error(`The ${channel} tag points outside the planned release history.`);
  }

  return [[channel, minor], ['latest', latest]]
    .filter(([, info]) => !info || info.digest !== targetDigest)
    .map(([tag]) => tag);
}

export async function planPublication(io, request) {
  const state = checkedState(io, request);
  if (state.plan.mode === 'complete') await verifyComplete(io, state);
  else {
    assertReleaseLicense(io.readSourceLicense(state.plan.sourceCommit));
    await verifiedBaseline(io, state);
  }
  return state.plan;
}

export async function preparePublication(io, request, expected) {
  const state = checkedState(io, request, expected);
  const { plan } = state;
  if (plan.mode === 'complete') {
    await verifyComplete(io, state);
    return { complete: true, build: false, digest: '' };
  }

  const existing = await io.registry.inspect(plan.version);
  if (existing) {
    if (plan.mode === 'fresh') throw new Error(`GHCR tag ${plan.version} already exists without a release reservation.`);
    assertSourceImage(io, existing, plan);
  } else {
    assertReleaseLicense(io.readSourceLicense(plan.sourceCommit));
  }
  await channelsToPromote(io, state, existing?.digest);

  if (plan.mode === 'fresh') io.reserveTag(plan, request.runId);
  return { complete: false, build: !existing, digest: existing?.digest ?? '' };
}

export async function finishPublication(io, request, expected, digest) {
  if (typeof digest !== 'string' || !digestPattern.test(digest)) {
    throw new Error('Publication requires a verified image digest.');
  }
  const state = checkedState(io, request, expected);
  const { plan } = state;
  if (plan.mode === 'complete') {
    await verifyComplete(io, state);
    return;
  }
  if (plan.mode !== 'resume') throw new Error(`Release tag v${plan.version} has not been reserved.`);

  await publishedImage(io, { ...plan, digest });
  const channels = await channelsToPromote(io, state, digest);
  for (const tag of channels) {
    // Re-read release metadata and aliases immediately before each mutable write.
    const current = checkedState(io, request, plan);
    if (current.plan.mode === 'complete') {
      await verifyComplete(io, current);
      return;
    }
    await publishedImage(io, { ...plan, digest });
    const remaining = await channelsToPromote(io, current, digest);
    if (remaining.includes(tag)) io.promoteTag(tag, digest);
  }

  const final = checkedState(io, request, plan);
  if (final.plan.mode === 'complete') {
    await verifyComplete(io, final);
    return;
  }
  await publishedImage(io, { ...plan, digest });
  if ((await channelsToPromote(io, final, digest)).length !== 0) {
    throw new Error('GHCR aliases do not both resolve to the verified image digest. Resume the release.');
  }
  io.publishRelease(plan, digest);
}

function command(program, args, options = {}) {
  return execFileSync(program, args, { encoding: 'utf8', ...options }).trim();
}

function git(...args) {
  return command('git', args);
}

function github(...args) {
  return command('gh', args);
}

function githubPost(path, payload) {
  return JSON.parse(command('gh', ['api', '--method', 'POST', path, '--input', '-'], {
    input: JSON.stringify(payload),
  }));
}

function readSnapshot() {
  git('fetch', '--prune', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/tags/v*:refs/tags/v*');
  const tags = git('for-each-ref', '--format=%(refname:strip=2)', 'refs/tags/v*')
    .split('\n')
    .flatMap(tag => {
      const version = parseVersionTag(tag);
      if (!version) return [];
      const ref = `refs/tags/${tag}`;
      const sourceCommit = git('rev-parse', `${ref}^{commit}`);
      const reservation = git('cat-file', '-t', ref) === 'tag'
        ? parseReservation(git('for-each-ref', '--format=%(contents:subject)', ref))
        : null;
      return [{ version, sourceCommit, reservation }];
    });

  const pages = JSON.parse(github('api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`));
  const releases = pages.flat().flatMap(release => {
    const version = parseVersionTag(release.tag_name);
    if (!version || release.draft || release.prerelease) return [];
    const tag = tags.find(item => item.version === version);
    if (!tag) throw new Error(`GitHub Release ${release.tag_name} has no source tag.`);
    const digest = release.body?.match(/^Image digest `?(sha256:[a-f0-9]{64})`?$/m)?.[1];
    return [{ version, sourceCommit: tag.sourceCommit, digest }];
  });
  return { tags, releases };
}

function assertAncestry({ sourceCommit, baseSourceCommit }) {
  try {
    git('merge-base', '--is-ancestor', sourceCommit, 'refs/remotes/origin/main');
    git('merge-base', '--is-ancestor', baseSourceCommit, sourceCommit);
  } catch {
    throw new Error('The planned source must be on main and descend from the previous release.');
  }
}

function readSourceLicense(sourceCommit) {
  // The workflow may be resuming a release from a different commit.
  return JSON.parse(git('show', `${sourceCommit}:package.json`))?.license;
}

function reserveTag(plan, runId) {
  const tag = `v${plan.version}`;
  const object = githubPost(`repos/${repository}/git/tags`, {
    tag,
    message: `im-overdue-release-v1 run=${runId} base=${plan.baseVersion}`,
    object: plan.sourceCommit,
    type: 'commit',
  });
  if (!/^[a-f0-9]{40}$/.test(object.sha)) throw new Error('GitHub did not return an annotated tag SHA.');
  githubPost(`repos/${repository}/git/refs`, { ref: `refs/tags/${tag}`, sha: object.sha });
}

function promoteTag(tag, digest) {
  command('docker', ['buildx', 'imagetools', 'create', '--tag', `${image}:${tag}`, `${image}@${digest}`]);
}

function publishRelease(plan, digest) {
  const tag = `v${plan.version}`;
  const notes = [
    `Container image for Linux AMD64 and ARM64 from commit \`${plan.sourceCommit}\`.`,
    '',
    `Image digest \`${digest}\``,
    '',
    '```sh',
    `docker pull ${image}:${plan.version}`,
    '```',
  ].join('\n');
  github('release', 'create', tag, '--repo', repository, '--verify-tag', '--latest', '--generate-notes', '--title', tag, '--notes', notes);
}

function output(values) {
  for (const [key, value] of Object.entries(values)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

async function main() {
  const env = process.env;
  if (env.GITHUB_REPOSITORY !== repository || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error(`Run Release manually on ${repository} main.`);
  }
  const request = {
    bump: env.RELEASE_BUMP,
    dispatchCommit: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
  };
  const io = { readSnapshot, assertAncestry, readSourceLicense, reserveTag, promoteTag, publishRelease, registry: createRegistry() };
  const action = process.argv[2];

  if (action === 'plan') {
    const plan = await planPublication(io, request);
    console.log(`Release ${plan.mode}: ${plan.version} at ${plan.sourceCommit}`);
    output({
      plan: JSON.stringify(plan),
      mode: plan.mode,
      version: plan.version,
      source_commit: plan.sourceCommit,
      build_date: git('show', '-s', '--format=%cI', plan.sourceCommit),
    });
    return;
  }

  const expected = JSON.parse(env.RELEASE_PLAN ?? 'null');
  if (!expected) throw new Error('Missing release plan.');
  if (action === 'prepare') output(await preparePublication(io, request, expected));
  else if (action === 'finish') await finishPublication(io, request, expected, env.RELEASE_DIGEST);
  else throw new Error(`Unknown release action: ${action}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

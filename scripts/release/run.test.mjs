import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOOTSTRAP } from './plan.mjs';
import { finishPublication, planPublication, preparePublication } from './run.mjs';

const dispatch = { bump: 'patch', dispatchCommit: '1'.repeat(40), runId: '100', attempt: 1 };
const patch = { version: '1.0.1', sourceCommit: dispatch.dispatchCommit, digest: `sha256:${'a'.repeat(64)}` };
const nextMinor = { version: '1.1.0', sourceCommit: '2'.repeat(40), digest: `sha256:${'b'.repeat(64)}` };

function releaseImage({ version, sourceCommit, digest }) {
  return {
    digest,
    platforms: ['amd64', 'arm64'].map(architecture => ({
      architecture,
      os: 'linux',
      labels: {
        'org.opencontainers.image.version': version,
        'org.opencontainers.image.revision': sourceCommit,
        'org.opencontainers.image.source': 'https://github.com/ill-yes/im-overdue',
        'org.opencontainers.image.licenses': 'PolyForm-Noncommercial-1.0.0',
      },
    })),
  };
}

function fixture() {
  const tags = [];
  const releases = [];
  const writes = [];
  const baseline = releaseImage(BOOTSTRAP);
  const images = new Map([[BOOTSTRAP.version, baseline], ['1.0', baseline], ['latest', baseline]]);
  const io = {
    readSnapshot: () => structuredClone({ tags, releases }),
    assertAncestry() {},
    registry: {
      async inspect(tag) {
        return images.get(tag) ?? null;
      },
    },
    reserveTag({ version, sourceCommit, baseVersion }, runId) {
      assert.ok(!tags.some(tag => tag.version === version));
      writes.push(['reserve', version, sourceCommit, baseVersion, runId]);
      tags.push({ version, sourceCommit, reservation: { runId, baseVersion } });
    },
    promoteTag(tag, digest) {
      const image = [...images.values()].find(candidate => candidate.digest === digest);
      assert.ok(image, `No image for ${digest}`);
      writes.push(['promote', tag, digest]);
      images.set(tag, image);
    },
    publishRelease({ version, sourceCommit }, digest) {
      assert.ok(!releases.some(release => release.version === version));
      writes.push(['release', version, sourceCommit, digest]);
      releases.push({ version, sourceCommit, digest });
    },
  };

  function pushExactImage(release) {
    assert.ok(tags.some(tag => tag.version === release.version && tag.sourceCommit === release.sourceCommit));
    assert.ok(!images.has(release.version));
    writes.push(['push', release.version, release.digest]);
    images.set(release.version, releaseImage(release));
  }

  return { io, tags, releases, images, writes, pushExactImage };
}

test('reserves the Git tag, builds only the exact image, then promotes and creates the release in order', async () => {
  const { io, images, releases, writes, pushExactImage } = fixture();
  const request = { ...dispatch, bump: 'minor', dispatchCommit: nextMinor.sourceCommit };
  const plan = await planPublication(io, request);
  assert.deepEqual(plan, {
    mode: 'fresh', version: nextMinor.version, sourceCommit: nextMinor.sourceCommit,
    baseVersion: BOOTSTRAP.version, baseSourceCommit: BOOTSTRAP.sourceCommit,
  });
  assert.deepEqual(writes, []);

  const reservation = ['reserve', nextMinor.version, nextMinor.sourceCommit, BOOTSTRAP.version, request.runId];
  assert.deepEqual(await preparePublication(io, request, plan), { complete: false, build: true, digest: '' });
  assert.deepEqual(writes, [reservation]);
  assert.ok(!images.has(nextMinor.version));
  assert.ok(!images.has('1.1'));
  assert.equal(images.get('latest').digest, BOOTSTRAP.digest);

  pushExactImage(nextMinor);
  assert.deepEqual(releases, []);
  assert.ok(!images.has('1.1'));
  assert.equal(images.get('latest').digest, BOOTSTRAP.digest);

  await finishPublication(io, request, plan, nextMinor.digest);
  assert.deepEqual(writes, [
    reservation,
    ['push', nextMinor.version, nextMinor.digest],
    ['promote', '1.1', nextMinor.digest],
    ['promote', 'latest', nextMinor.digest],
    ['release', nextMinor.version, nextMinor.sourceCommit, nextMinor.digest],
  ]);
  assert.deepEqual(releases, [nextMinor]);
  assert.equal(images.get('1.0').digest, BOOTSTRAP.digest);
  for (const tag of [nextMinor.version, '1.1', 'latest']) assert.equal(images.get(tag).digest, nextMinor.digest);
});

test('resumes after reservation, exact image push and a failed second promotion', async () => {
  const { io, images, releases, writes, pushExactImage } = fixture();
  const plan = await planPublication(io, dispatch);
  await preparePublication(io, dispatch, plan);
  const retry = { ...dispatch, attempt: 2 };
  const resumePlan = await planPublication(io, retry);
  assert.deepEqual(resumePlan, { ...plan, mode: 'resume' });
  assert.deepEqual(await preparePublication(io, retry, resumePlan), { complete: false, build: true, digest: '' });
  assert.deepEqual(writes, [['reserve', patch.version, patch.sourceCommit, BOOTSTRAP.version, dispatch.runId]]);

  pushExactImage(patch);
  writes.length = 0;
  assert.deepEqual(await preparePublication(io, retry, resumePlan), { complete: false, build: false, digest: patch.digest });
  assert.deepEqual(writes, []);

  const promoteTag = io.promoteTag;
  io.promoteTag = (tag, digest) => {
    if (tag === 'latest') throw new Error('simulated registry write failure');
    promoteTag(tag, digest);
  };
  await assert.rejects(finishPublication(io, retry, resumePlan, patch.digest), /simulated registry write failure/);
  assert.deepEqual(writes, [['promote', '1.0', patch.digest]]);
  assert.deepEqual(releases, []);
  assert.equal(images.get('1.0').digest, patch.digest);
  assert.equal(images.get('latest').digest, BOOTSTRAP.digest);

  io.promoteTag = promoteTag;
  const finalRetry = { ...retry, attempt: 3 };
  const finalPlan = await planPublication(io, finalRetry);
  assert.deepEqual(await preparePublication(io, finalRetry, finalPlan), { complete: false, build: false, digest: patch.digest });
  await finishPublication(io, finalRetry, finalPlan, patch.digest);
  assert.deepEqual(writes, [
    ['promote', '1.0', patch.digest],
    ['promote', 'latest', patch.digest],
    ['release', patch.version, patch.sourceCommit, patch.digest],
  ]);
  assert.deepEqual(releases, [patch]);
});

test('keeps a completed release read-only when a newer release has advanced latest', async () => {
  const { io, tags, releases, images, writes } = fixture();
  tags.push(
    { version: patch.version, sourceCommit: patch.sourceCommit, reservation: { runId: dispatch.runId, baseVersion: BOOTSTRAP.version } },
    { version: nextMinor.version, sourceCommit: nextMinor.sourceCommit, reservation: null },
  );
  releases.push(patch, nextMinor);
  const newerImage = releaseImage(nextMinor);
  const patchImage = releaseImage(patch);
  images.set(patch.version, patchImage);
  images.set('1.0', patchImage);
  images.set(nextMinor.version, newerImage);
  images.set('1.1', newerImage);
  images.set('latest', newerImage);

  const retry = { ...dispatch, attempt: 2 };
  const plan = await planPublication(io, retry);
  assert.equal(plan.mode, 'complete');
  assert.equal(plan.version, patch.version);
  assert.deepEqual(await preparePublication(io, retry, plan), { complete: true, build: false, digest: '' });
  await finishPublication(io, retry, plan, patch.digest);
  assert.deepEqual(writes, []);
  assert.equal(images.get('latest').digest, nextMinor.digest);

  images.delete(patch.version);
  await assert.rejects(planPublication(io, retry), /Published image .* is missing/);
  assert.deepEqual(writes, []);
});

test('refuses to reserve a fresh release when the exact image tag is already occupied', async () => {
  const { io, tags, images, writes } = fixture();
  const plan = await planPublication(io, dispatch);
  images.set(patch.version, releaseImage(patch));

  await assert.rejects(preparePublication(io, dispatch, plan), /already exists without a release reservation/);
  assert.deepEqual(tags, []);
  assert.deepEqual(writes, []);
  assert.equal(images.get('latest').digest, BOOTSTRAP.digest);
});

test('rejects a validated plan made stale by another release before reserving a tag', async () => {
  const { io, tags, releases, images, writes } = fixture();
  const plan = await planPublication(io, dispatch);
  tags.push({ version: nextMinor.version, sourceCommit: nextMinor.sourceCommit, reservation: null });
  releases.push(nextMinor);
  const newerImage = releaseImage(nextMinor);
  for (const tag of [nextMinor.version, '1.1', 'latest']) images.set(tag, newerImage);

  await assert.rejects(preparePublication(io, dispatch, plan), /Release plan changed since validation/);
  assert.deepEqual(writes, []);
  assert.equal(images.get('latest').digest, nextMinor.digest);
});

test('propagates a registry read failure before reserving a release', async () => {
  const { io, tags, writes } = fixture();
  const plan = await planPublication(io, dispatch);
  const inspect = io.registry.inspect;
  io.registry.inspect = async tag => {
    if (tag === 'latest') throw new Error('simulated registry read failure');
    return inspect(tag);
  };

  await assert.rejects(preparePublication(io, dispatch, plan), /simulated registry read failure/);
  assert.deepEqual(tags, []);
  assert.deepEqual(writes, []);
});

test('blocks alias promotion when the build digest or an architecture label differs', async () => {
  const { io, images, releases, writes, pushExactImage } = fixture();
  const plan = await planPublication(io, dispatch);
  await preparePublication(io, dispatch, plan);
  pushExactImage(patch);
  writes.length = 0;

  await assert.rejects(finishPublication(io, dispatch, plan, nextMinor.digest), /index digest does not match/);
  const image = images.get(patch.version);
  image.platforms.find(platform => platform.architecture === 'arm64').labels['org.opencontainers.image.revision'] = nextMinor.sourceCommit;
  await assert.rejects(preparePublication(io, dispatch, plan), /linux\/arm64: unexpected org.opencontainers.image.revision label/);
  await assert.rejects(finishPublication(io, dispatch, plan, patch.digest), /linux\/arm64: unexpected org.opencontainers.image.revision label/);
  assert.deepEqual(writes, []);
  assert.deepEqual(releases, []);
  assert.equal(images.get('1.0').digest, BOOTSTRAP.digest);
  assert.equal(images.get('latest').digest, BOOTSTRAP.digest);
});

test('stops further writes when latest changes unexpectedly during promotion', async () => {
  const { io, images, releases, writes, pushExactImage } = fixture();
  const plan = await planPublication(io, dispatch);
  await preparePublication(io, dispatch, plan);
  pushExactImage(patch);
  writes.length = 0;

  const promoteTag = io.promoteTag;
  io.promoteTag = (tag, digest) => {
    promoteTag(tag, digest);
    if (tag === '1.0') images.set('latest', releaseImage(nextMinor));
  };
  await assert.rejects(finishPublication(io, dispatch, plan, patch.digest), /latest tag points outside the planned release history/);
  assert.deepEqual(writes, [['promote', '1.0', patch.digest]]);
  assert.deepEqual(releases, []);
  assert.equal(images.get('1.0').digest, patch.digest);
  assert.equal(images.get('latest').digest, nextMinor.digest);
});

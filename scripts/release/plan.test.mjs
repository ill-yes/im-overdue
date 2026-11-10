import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPublishPlan, BOOTSTRAP, parseReservation, parseVersionTag, releasedVersions, resolveReleasePlan } from './plan.mjs';

const first = '1'.repeat(40);
const second = '2'.repeat(40);
const third = '3'.repeat(40);
const dispatch = { bump: 'patch', dispatchCommit: first, runId: '100', attempt: 1 };
const reserved = { version: '1.0.1', sourceCommit: first, reservation: { runId: dispatch.runId, baseVersion: '1.0.0' } };

function snapshot(tags = [], releases = []) {
  return { tags, releases };
}

function releaseFor(tag) {
  return { version: tag.version, sourceCommit: tag.sourceCommit };
}

function plan(mode, version, sourceCommit, base = BOOTSTRAP) {
  return { mode, version, sourceCommit, baseVersion: base.version, baseSourceCommit: base.sourceCommit };
}

test('reads only canonical stable version tags and exact reservation subjects', () => {
  assert.equal(parseVersionTag('v0.0.0'), '0.0.0');
  assert.equal(parseVersionTag('v1.10.99999999999999999999'), '1.10.99999999999999999999');
  for (const invalid of [null, '1.2.3', 'V1.2.3', 'v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.2.3-rc.1', 'v1.2.3+build', 'v1.2.3\n']) {
    assert.equal(parseVersionTag(invalid), null);
  }
  assert.deepEqual(parseReservation('im-overdue-release-v1 run=123 base=1.0.0'), { runId: '123', baseVersion: '1.0.0' });
  for (const invalid of [null, 'im-overdue-release-v1 run=0 base=1.0.0', 'im-overdue-release-v1 run=001 base=1.0.0',
    'im-overdue-release-v1 run=123 base=v1.0.0', 'im-overdue-release-v1 run=123 base=1.0.0 extra',
    'im-overdue-release-v1 run=123 base=1.0.0\n', 'im-overdue-release-v2 run=123 base=1.0.0']) {
    assert.equal(parseReservation(invalid), null);
  }
});

test('includes the existing image release before any GitHub Release or tag exists', () => {
  assert.deepEqual(releasedVersions(snapshot()), [BOOTSTRAP]);
  assert.deepEqual(resolveReleasePlan(snapshot(), dispatch), plan('fresh', '1.0.1', first));
  assert.deepEqual(resolveReleasePlan(snapshot(), { ...dispatch, dispatchCommit: BOOTSTRAP.sourceCommit }),
    plan('complete', '1.0.0', BOOTSTRAP.sourceCommit));
  assert.deepEqual(releasedVersions(snapshot([], [BOOTSTRAP])), [BOOTSTRAP]);
});

test('orders releases numerically and bumps the newest version with exact integer arithmetic', () => {
  const tags = [
    { version: '0.9.0', sourceCommit: first, reservation: null },
    { version: '1.9.123', sourceCommit: first, reservation: null },
    { version: '1.10.9007199254740993', sourceCommit: second, reservation: null },
  ];
  const state = snapshot(tags, tags.map(releaseFor));
  assert.deepEqual(releasedVersions(state), [releaseFor(tags[2]), releaseFor(tags[1]), BOOTSTRAP, releaseFor(tags[0])]);
  const nextDispatch = { ...dispatch, dispatchCommit: third };
  const base = tags[2];
  assert.deepEqual(resolveReleasePlan(state, nextDispatch), plan('fresh', '1.10.9007199254740994', third, base));
  assert.deepEqual(resolveReleasePlan(state, { ...nextDispatch, bump: 'minor' }), plan('fresh', '1.11.0', third, base));
  assert.deepEqual(resolveReleasePlan(state, { ...nextDispatch, bump: 'major' }), plan('fresh', '2.0.0', third, base));
});

test('resumes the recorded version and commit for a fresh dispatch or matching run retry', () => {
  const state = snapshot([reserved]);
  assert.deepEqual(resolveReleasePlan(state, { ...dispatch, bump: 'major', runId: '101', dispatchCommit: second }),
    plan('resume', '1.0.1', first));
  assert.deepEqual(resolveReleasePlan(state, { ...dispatch, attempt: 2 }), plan('resume', '1.0.1', first));
  assert.deepEqual(resolveReleasePlan(state, { ...dispatch, attempt: 2, runId: '101' }), plan('resume', '1.0.1', first));
});

test('requires a fresh dispatch when a full retry has no matching release or reservation', () => {
  assert.throws(() => resolveReleasePlan(snapshot(), { ...dispatch, attempt: 2 }), /fresh workflow dispatch/);
  assert.throws(() => resolveReleasePlan(snapshot([reserved]), { ...dispatch, attempt: 2, runId: '101', dispatchCommit: second }),
    /fresh workflow dispatch/);
});

test('finds completed releases by dispatch commit and by original reservation run', () => {
  const state = snapshot([reserved], [releaseFor(reserved)]);
  const complete = plan('complete', '1.0.1', first);
  assert.deepEqual(resolveReleasePlan(state, { ...dispatch, attempt: 3, runId: '101' }), complete);
  assert.deepEqual(resolveReleasePlan(state, { ...dispatch, attempt: 3, dispatchCommit: second }), complete);
});

test('rejects pending tags without a reservation, multiple candidates and invalid reservation bumps', () => {
  assert.throws(() => resolveReleasePlan(snapshot([{ ...reserved, reservation: null }]), dispatch), /no release reservation/);
  const another = { version: '1.1.0', sourceCommit: second, reservation: { runId: '101', baseVersion: '1.0.0' } };
  assert.throws(() => resolveReleasePlan(snapshot([reserved, another]), dispatch), /Multiple pending stable release tags/);
  assert.throws(() => resolveReleasePlan(snapshot([{ ...reserved, version: '1.0.2' }]), dispatch), /Invalid release reservation/);
  assert.throws(() => resolveReleasePlan(snapshot([reserved, { ...another, reservation: reserved.reservation }]), dispatch),
    /Multiple Git tags reserve release run/);
});

test('rejects a pending tag when another version supersedes its base', () => {
  const newer = { version: '1.1.0', sourceCommit: second, reservation: null };
  assert.throws(() => resolveReleasePlan(snapshot([reserved, newer], [releaseFor(newer)]), dispatch), /stale base/);
});

test('rejects contradictory Release records and bootstrap collisions', () => {
  const release = releaseFor(reserved);
  assert.throws(() => resolveReleasePlan(snapshot([], [release]), dispatch), /requires a matching Git tag/);
  assert.throws(() => resolveReleasePlan(snapshot([reserved], [{ ...release, sourceCommit: second }]), dispatch), /matching Git tag/);
  assert.throws(() => resolveReleasePlan(snapshot([reserved], [release, release]), dispatch), /Duplicate GitHub Release/);
  assert.throws(() => resolveReleasePlan(snapshot([reserved, reserved]), dispatch), /Duplicate Git tag/);
  assert.throws(() => resolveReleasePlan(snapshot([{ ...reserved, version: '1.0.0', reservation: null }]), dispatch), /bootstrap release/);
  assert.throws(() => resolveReleasePlan(snapshot([], [{ ...BOOTSTRAP, digest: `sha256:${'0'.repeat(64)}` }]), dispatch), /bootstrap release/);
});

test('rejects noncanonical workflow input and snapshot identifiers', () => {
  for (const invalid of [{ bump: 'PATCH' }, { dispatchCommit: 'abc1234' }, { runId: 100 }, { runId: '0100' },
    { attempt: '1' }, { attempt: 0 }, { attempt: 1.5 }]) {
    assert.throws(() => resolveReleasePlan(snapshot(), { ...dispatch, ...invalid }), /Release request/);
  }
  assert.throws(() => resolveReleasePlan(snapshot([{ ...reserved, sourceCommit: 'x'.repeat(40) }]), dispatch), /full Git commit SHA/);
  assert.throws(() => resolveReleasePlan(snapshot([{ ...reserved, reservation: { ...reserved.reservation, runId: '0' } }]), dispatch),
    /Invalid release reservation/);
});

test('allows a publish-only retry after reserving the validated version', () => {
  const expected = resolveReleasePlan(snapshot(), dispatch);
  assert.deepEqual(assertPublishPlan(snapshot(), { ...dispatch, attempt: 2 }, expected), expected);
  assert.deepEqual(assertPublishPlan(snapshot([reserved]), { ...dispatch, attempt: 2 }, expected), plan('resume', '1.0.1', first));
});

test('requires the reservation for a previously validated recovery plan', () => {
  const expected = resolveReleasePlan(snapshot([reserved]), dispatch);
  assert.throws(() => assertPublishPlan(snapshot(), dispatch, expected), /reservation .* missing/);
  assert.throws(() => assertPublishPlan(snapshot([{ ...reserved, sourceCommit: second }]), dispatch, expected), /plan changed/);
  assert.throws(() => assertPublishPlan(snapshot([{ ...reserved, reservation: null }], [releaseFor(reserved)]), dispatch, expected),
    /reservation .* missing/);
});

test('returns a no-op after the same release completes and later versions advance', () => {
  const recovery = { ...dispatch, runId: '101', dispatchCommit: third };
  const expected = resolveReleasePlan(snapshot([reserved]), recovery);
  const newer = { version: '1.1.0', sourceCommit: second, reservation: { runId: '102', baseVersion: '1.0.1' } };
  const state = snapshot([reserved, newer], [releaseFor(reserved), releaseFor(newer)]);
  assert.deepEqual(resolveReleasePlan(state, recovery), plan('fresh', '1.1.1', third, newer));
  assert.deepEqual(assertPublishPlan(state, recovery, expected), plan('complete', '1.0.1', first));
  assert.deepEqual(assertPublishPlan(state, dispatch, plan('fresh', '1.0.1', first)), plan('complete', '1.0.1', first));
  assert.throws(() => assertPublishPlan(state, recovery, { ...expected, mode: 'invalid' }), /valid mode/);
});

test('rejects stale publish outputs even if the newly computed candidate has the same version and commit', () => {
  const majorDispatch = { ...dispatch, bump: 'major' };
  const expected = resolveReleasePlan(snapshot(), majorDispatch);
  const intervening = { version: '1.0.1', sourceCommit: second, reservation: null };
  const state = snapshot([intervening], [releaseFor(intervening)]);
  assert.deepEqual(resolveReleasePlan(state, majorDispatch), plan('fresh', '2.0.0', first, intervening));
  assert.throws(() => assertPublishPlan(state, majorDispatch, expected), /plan changed/);
  assert.throws(() => assertPublishPlan(snapshot(), dispatch, { ...plan('fresh', '1.0.1', first), baseSourceCommit: second }), /plan changed/);
});

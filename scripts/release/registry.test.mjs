import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { assertReleaseImage, createRegistry } from './registry.mjs';

const version = '1.0.0';
const sourceCommit = 'f'.repeat(40);
const source = 'https://github.com/ill-yes/im-overdue';
const token = 'fake-anonymous-pull-token';
const registry = 'https://ghcr.io';
const cdn = 'https://pkg-containers.githubusercontent.com';
const imagePath = '/v2/ill-yes/im-overdue';
const manifestUrl = ref => `${registry}${imagePath}/manifests/${ref}`;
const blobUrl = digest => `${registry}${imagePath}/blobs/${digest}`;
const ociIndex = 'application/vnd.oci.image.index.v1+json';
const dockerIndex = 'application/vnd.docker.distribution.manifest.list.v2+json';
const ociManifest = 'application/vnd.oci.image.manifest.v1+json';
const dockerManifest = 'application/vnd.docker.distribution.manifest.v2+json';
const ociConfig = 'application/vnd.oci.image.config.v1+json';
const dockerConfig = 'application/vnd.docker.container.image.v1+json';
const labels = {
  'org.opencontainers.image.version': version,
  'org.opencontainers.image.revision': sourceCommit,
  'org.opencontainers.image.source': source,
  'org.opencontainers.image.licenses': 'MIT',
};
const release = { version, sourceCommit, license: 'MIT' };

function encode(document, mediaType) {
  const bytes = JSON.stringify(document);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  return { bytes, digest, size: Buffer.byteLength(bytes), mediaType };
}

function descriptor({ mediaType, digest, size }, fields = {}) {
  return { mediaType, digest, size, ...fields };
}

function response({ bytes, digest, mediaType }, headers = {}) {
  return new Response(bytes, {
    headers: { 'Content-Type': mediaType, 'Docker-Content-Digest': digest, ...headers },
  });
}

function fixture({ docker = false, attestation, alterIndex, alterImageConfig, alterAttestation } = {}) {
  const calls = [];
  const routes = new Map();
  const indexType = docker ? dockerIndex : ociIndex;
  const manifestType = docker ? dockerManifest : ociManifest;
  const configType = docker ? dockerConfig : ociConfig;
  const layerType = docker ? 'application/vnd.docker.image.rootfs.diff.tar.gzip' : 'application/vnd.oci.image.layer.v1.tar+gzip';
  const layer = descriptor(encode({ sample: 'compressed image layer' }, layerType));
  const manifests = [];
  const configs = [];
  for (const architecture of ['amd64', 'arm64']) {
    const config = {
      architecture,
      os: 'linux',
      config: { Env: [`TARGETARCH=${architecture}`], Labels: { ...labels } },
      rootfs: { type: 'layers', diff_ids: [layer.digest] },
    };
    alterImageConfig?.(config, architecture);
    const blob = encode(config, configType);
    configs.push(blob);
    const manifest = encode({
      schemaVersion: 2,
      mediaType: manifestType,
      config: descriptor(blob),
      layers: [layer],
    }, manifestType);
    manifests.push(descriptor(manifest, { platform: { os: 'linux', architecture } }));
    routes.set(manifestUrl(manifest.digest), () => response(manifest));
    routes.set(blobUrl(blob.digest), () => response(blob));
  }
  if (attestation) {
    const target = manifests[0];
    const document = {
      schemaVersion: 2,
      mediaType: ociManifest,
      config: descriptor(encode({}, ociConfig)),
      layers: [descriptor(encode({ subject: target.digest }, 'application/vnd.in-toto+json'))],
    };
    if (attestation === 'oci') {
      document.artifactType = 'application/vnd.docker.attestation.manifest.v1+json';
      document.subject = descriptor(target);
      document.config = descriptor(encode({}, 'application/vnd.oci.empty.v1+json'));
    }
    alterAttestation?.(document);
    const manifest = encode(document, ociManifest);
    routes.set(manifestUrl(manifest.digest), () => response(manifest));
    manifests.push(descriptor(manifest, {
      platform: { os: 'unknown', architecture: 'unknown' },
      annotations: {
        'vnd.docker.reference.type': 'attestation-manifest',
        'vnd.docker.reference.digest': target.digest,
      },
    }));
  }
  const indexDocument = { schemaVersion: 2, mediaType: indexType, manifests };
  alterIndex?.(indexDocument);
  const index = encode(indexDocument, indexType);
  for (const ref of [version, '1.0', 'latest', index.digest]) {
    routes.set(manifestUrl(ref), () => response(index));
  }
  const tokenUrl = new URL('/token', registry);
  tokenUrl.searchParams.set('service', 'ghcr.io');
  tokenUrl.searchParams.set('scope', 'repository:ill-yes/im-overdue:pull');
  routes.set(tokenUrl.href, () => Response.json({ token }));
  const client = createRegistry({
    async fetchImpl(input, init) {
      const url = new URL(input);
      const headers = new Headers(init.headers);
      calls.push({ url, headers });
      assert.equal(init.redirect, 'manual');
      assert.equal(init.signal.aborted, false);
      assert.equal(headers.get('authorization'), url.origin === registry && url.pathname.startsWith(imagePath)
        ? `Bearer ${token}` : null);
      const route = routes.get(url.href);
      assert.ok(route, `missing fixture for ${url.origin}${url.pathname}`);
      return route();
    },
  });
  return { client, calls, routes, manifests, configs, index, tokenUrl: tokenUrl.href };
}

test('verifies exact tag, aliases and digests for an OCI index with BuildKit attestations', async () => {
  const { client, calls, index } = fixture({ attestation: 'oci' });
  for (const ref of [version, '1.0', 'latest', index.digest]) {
    const info = await client.inspect(ref);
    assert.deepEqual(info, {
      digest: index.digest,
      platforms: ['amd64', 'arm64'].map(architecture => ({ os: 'linux', architecture, labels })),
    });
    assertReleaseImage(info, { ...release, digest: index.digest });
  }
  assert.equal(calls.filter(call => call.url.pathname === '/token').length, 4);
  assert.ok(calls.find(call => call.url.href === manifestUrl(version)).headers.get('accept').includes(ociIndex));
});

test('accepts Docker manifest lists and legacy BuildKit attestations', async () => {
  for (const options of [{ docker: true }, { attestation: 'legacy' }]) {
    const { client, index } = fixture(options);
    assertReleaseImage(await client.inspect(version), { ...release, digest: index.digest });
  }
});

test('confirms tag absence only for an authenticated MANIFEST_UNKNOWN response', async () => {
  const { client, routes, index, tokenUrl } = fixture();
  const missing = () => Response.json({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }, { status: 404 });
  routes.set(manifestUrl(version), missing);
  assert.equal(await client.inspect(version), null);

  routes.set(manifestUrl(index.digest), missing);
  await assert.rejects(client.inspect(index.digest), /unexpected HTTP 404/);

  for (const status of [401, 403, 429, 500]) {
    routes.set(manifestUrl(version), () => Response.json({ errors: [{ code: 'MANIFEST_UNKNOWN' }] }, { status }));
    await assert.rejects(client.inspect(version), new RegExp(`unexpected HTTP ${status}`));
  }
  routes.set(manifestUrl(version), () => Response.json({ errors: [{ code: 'NAME_UNKNOWN' }] }, { status: 404 }));
  await assert.rejects(client.inspect(version), /HTTP 404 without a MANIFEST_UNKNOWN error/);
  routes.set(manifestUrl(version), () => new Response('404 Page Not Found', { status: 404 }));
  await assert.rejects(client.inspect(version), /invalid JSON/);
  routes.set(manifestUrl(version), () => { throw new TypeError('network failure'); });
  await assert.rejects(client.inspect(version), /request failed/);
  routes.set(tokenUrl, missing);
  await assert.rejects(client.inspect(version), /anonymous pull token: unexpected HTTP 404/);
  routes.set(tokenUrl, () => Response.json({ token: 'invalid token\r\n' }));
  await assert.rejects(client.inspect(version), /missing or invalid token/);
});

test('rejects invalid references before any request', async () => {
  const { client, calls } = fixture();
  for (const ref of [undefined, '', '../latest', 'v1.0.0', '01.0.0', '1.0.0-beta.1', '1.0.0\n', 'sha256:1234']) {
    await assert.rejects(client.inspect(ref), /expected X\.Y\.Z, X\.Y, latest, or a sha256 digest/);
  }
  assert.equal(calls.length, 0);
});

test('rejects an unverified index digest and inconsistent child and config bytes', async () => {
  const { client, routes, index, manifests, configs } = fixture();
  const wrongDigest = `sha256:${'0'.repeat(64)}`;
  routes.set(manifestUrl(version), () => response(index, { 'Docker-Content-Digest': wrongDigest }));
  await assert.rejects(client.inspect(version), /content digest or descriptor size/);
  routes.set(manifestUrl(version), () => new Response(index.bytes, { headers: { 'Content-Type': index.mediaType } }));
  await assert.rejects(client.inspect(version), /content digest or descriptor size/);
  routes.set(manifestUrl(wrongDigest), () => response(index));
  await assert.rejects(client.inspect(wrongDigest), /content digest or descriptor size/);
  routes.set(manifestUrl(version), () => response(index));
  routes.set(manifestUrl(manifests[0].digest), () => response({ ...manifests[0], bytes: '{}' }));
  await assert.rejects(client.inspect(version), /content digest or descriptor size/);

  const second = fixture();
  second.routes.set(blobUrl(configs[0].digest), () => response({ ...configs[0], bytes: '{}' }));
  await assert.rejects(second.client.inspect(version), /content digest or descriptor size/);

  const wrongSize = fixture({ alterIndex: document => { document.manifests[0].size += 1; } });
  await assert.rejects(wrongSize.client.inspect(version), /content digest or descriptor size/);
});

test('accepts signed GHCR blob redirects without sending the Bearer token', async () => {
  const { client, routes, configs, calls, index } = fixture();
  const location = `${cdn}/signed-config?signature=fixture`;
  routes.set(blobUrl(configs[0].digest), () => Response.redirect(location, 307));
  routes.set(location, () => new Response(configs[0].bytes));
  assertReleaseImage(await client.inspect(version), { ...release, digest: index.digest });
  assert.equal(calls.find(call => call.url.href === location).headers.get('authorization'), null);
  for (const unsafe of ['https://example.com/blob', 'http://pkg-containers.githubusercontent.com/blob', 'https://example.com@pkg-containers.githubusercontent.com/blob']) {
    routes.set(blobUrl(configs[0].digest), () => Response.redirect(unsafe, 307));
    await assert.rejects(client.inspect(version), /unsafe blob redirect/);
  }
});

test('rejects inconsistent architectures, extra platforms and unknown attestations', async () => {
  const wrongArch = fixture({ alterImageConfig: (config, architecture) => {
    if (architecture === 'arm64') config.architecture = 'amd64';
  } });
  await assert.rejects(wrongArch.client.inspect(version), /config platform differs/);
  const extra = fixture({ alterIndex: document => {
    document.manifests.push({
      ...document.manifests[0],
      digest: `sha256:${'0'.repeat(64)}`,
      platform: { os: 'linux', architecture: '386' },
    });
  } });
  await assert.rejects(extra.client.inspect(version), /unexpected or duplicate platform/);
  const duplicate = fixture({ alterIndex: document => {
    document.manifests[1].platform.architecture = 'amd64';
  } });
  await assert.rejects(duplicate.client.inspect(version), /unexpected or duplicate platform/);
  const unrelated = fixture({ attestation: 'oci', alterIndex: document => {
    document.manifests[2].annotations['vnd.docker.reference.digest'] = `sha256:${'0'.repeat(64)}`;
  } });
  await assert.rejects(unrelated.client.inspect(version), /target does not match a runnable image/);
  const malformed = fixture({ attestation: 'oci', alterAttestation: document => {
    document.subject.size++;
  } });
  await assert.rejects(malformed.client.inspect(version), /invalid BuildKit attestation subject/);
});

test('checks all required labels on both architectures and an optional expected digest', async () => {
  const { client, index } = fixture();
  const info = await client.inspect(version);
  assertReleaseImage(info, release);
  assert.throws(() => assertReleaseImage(info, {
    ...release, digest: `sha256:${'0'.repeat(64)}`,
  }), /index digest does not match/);
  assert.throws(() => assertReleaseImage(null, release), /index digest does not match/);
  for (const architecture of ['amd64', 'arm64']) {
    for (const label of Object.keys(labels)) {
      const wrong = structuredClone(info);
      delete wrong.platforms.find(platform => platform.architecture === architecture).labels[label];
      assert.throws(() => assertReleaseImage(wrong, { ...release, digest: index.digest }),
        { message: `GHCR linux/${architecture}: unexpected ${label} label` });
    }
  }
});

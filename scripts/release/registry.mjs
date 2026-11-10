import { createHash } from 'node:crypto';

const registry = 'https://ghcr.io';
const imagePath = '/v2/ill-yes/im-overdue';
const tokenUrl = new URL('/token', registry);
tokenUrl.searchParams.set('service', 'ghcr.io');
tokenUrl.searchParams.set('scope', 'repository:ill-yes/im-overdue:pull');
const blobOrigin = 'https://pkg-containers.githubusercontent.com';

const ociIndex = 'application/vnd.oci.image.index.v1+json';
const dockerIndex = 'application/vnd.docker.distribution.manifest.list.v2+json';
const ociManifest = 'application/vnd.oci.image.manifest.v1+json';
const dockerManifest = 'application/vnd.docker.distribution.manifest.v2+json';
const ociConfig = 'application/vnd.oci.image.config.v1+json';
const dockerConfig = 'application/vnd.docker.container.image.v1+json';
const indexTypes = [ociIndex, dockerIndex];
const manifestTypes = [ociManifest, dockerManifest];
const layerTypes = new Set([
  'application/vnd.oci.image.layer.v1.tar',
  'application/vnd.oci.image.layer.v1.tar+gzip',
  'application/vnd.oci.image.layer.v1.tar+zstd',
  'application/vnd.docker.image.rootfs.diff.tar',
  'application/vnd.docker.image.rootfs.diff.tar.gzip',
]);
const accept = [...indexTypes, ...manifestTypes].join(', ');
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const tagPattern = /^(latest|(0|[1-9]\d*)\.(0|[1-9]\d*)(\.(0|[1-9]\d*))?)$/;
const architectures = ['amd64', 'arm64'];
const maxMetadataBytes = 1024 * 1024;

function fail(context, reason) {
  throw new Error(`GHCR ${context}: ${reason}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDigest(value) {
  return typeof value === 'string' && digestPattern.test(value);
}

function isDescriptor(value) {
  return isObject(value) && typeof value.mediaType === 'string'
    && isDigest(value.digest) && Number.isSafeInteger(value.size) && value.size > 0;
}

function discard(response) {
  void response.body?.cancel().catch(() => {});
}

async function readMetadata(response, context, expected = {}) {
  if (!response.body || Number(response.headers.get('content-length')) > maxMetadataBytes) {
    discard(response);
    fail(context, 'missing body or metadata exceeds 1 MiB');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxMetadataBytes) fail(context, 'metadata exceeds 1 MiB');
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, length);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const header = response.headers.get('docker-content-digest');
  if ((expected.requireHeader && header === null) || (header !== null && header !== digest)
    || (expected.digest !== undefined && expected.digest !== digest)
    || (expected.size !== undefined && expected.size !== length)) {
    fail(context, 'content digest or descriptor size does not match the response bytes');
  }
  let document;
  try {
    document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail(context, 'invalid JSON');
  }
  if (!isObject(document)) fail(context, 'expected a JSON object');
  return { document, digest };
}

function checkStatus(response, context) {
  if (response.status !== 200) {
    discard(response);
    fail(context, `unexpected HTTP ${response.status}`);
  }
}

function checkPlatform(platform) {
  return isObject(platform) && platform.os === 'linux' && architectures.includes(platform.architecture)
    && (platform.variant === undefined || platform.variant === (platform.architecture === 'arm64' ? 'v8' : 'v1'));
}

function classifyDescriptors(manifests, context) {
  if (!Array.isArray(manifests) || manifests.length < 2 || manifests.length > 16) {
    fail(context, 'expected between 2 and 16 image index descriptors');
  }
  const runnable = new Map();
  const attestations = [];
  const seen = new Set();
  for (const descriptor of manifests) {
    if (!isDescriptor(descriptor) || !manifestTypes.includes(descriptor.mediaType)
      || !isObject(descriptor.platform) || seen.has(descriptor.digest)) {
      fail(context, 'invalid or duplicate image manifest descriptor');
    }
    seen.add(descriptor.digest);
    const { platform, annotations } = descriptor;
    if (descriptor.mediaType === ociManifest && platform.os === 'unknown' && platform.architecture === 'unknown'
      && annotations?.['vnd.docker.reference.type'] === 'attestation-manifest'
      && isDigest(annotations['vnd.docker.reference.digest'])) {
      attestations.push(descriptor);
    } else if (checkPlatform(platform) && !runnable.has(platform.architecture)
      && annotations?.['vnd.docker.reference.type'] === undefined && descriptor.artifactType === undefined) {
      runnable.set(platform.architecture, descriptor);
    } else {
      fail(context, 'unexpected or duplicate platform in image index');
    }
  }
  if (runnable.size !== architectures.length) fail(context, 'expected linux/amd64 and linux/arm64');
  return { runnable, attestations };
}

function verifyAttestation(manifest, target, context) {
  if (manifest.layers.some(({ mediaType }) => mediaType !== 'application/vnd.in-toto+json')) {
    fail(context, 'unexpected BuildKit attestation layers');
  }
  if (manifest.artifactType === undefined && manifest.subject === undefined && manifest.config.mediaType === ociConfig) {
    return;
  }
  const { subject, config } = manifest;
  if (manifest.artifactType !== 'application/vnd.docker.attestation.manifest.v1+json'
    || config.mediaType !== 'application/vnd.oci.empty.v1+json' || config.size !== 2
    || config.digest !== 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
    || !isDescriptor(subject) || subject.digest !== target.digest
    || subject.size !== target.size || subject.mediaType !== target.mediaType) {
    fail(context, 'invalid BuildKit attestation subject or config');
  }
}

export function createRegistry({ fetchImpl = fetch } = {}) {
  return {
    async inspect(ref) {
      if (typeof ref !== 'string' || ref.length > 128 || (!tagPattern.test(ref) && !isDigest(ref))) {
        fail('reference', 'expected X.Y.Z, X.Y, latest, or a sha256 digest');
      }
      const signal = AbortSignal.timeout(30_000);
      async function request(url, context, headers) {
        try {
          return await fetchImpl(url, { headers, signal, redirect: 'manual' });
        } catch {
          fail(context, 'request failed');
        }
      }
      const tokenResponse = await request(tokenUrl.href, 'anonymous pull token');
      checkStatus(tokenResponse, 'anonymous pull token');
      const { document: { token } } = await readMetadata(tokenResponse, 'anonymous pull token');
      if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) {
        fail('anonymous pull token', 'missing or invalid token');
      }
      const authorization = `Bearer ${token}`;

      async function manifest(reference, descriptor) {
        const context = `manifest ${reference}`;
        const response = await request(`${registry}${imagePath}/manifests/${reference}`, context, { accept, authorization });
        if (response.status === 404 && !descriptor && !isDigest(reference)) {
          const { document } = await readMetadata(response, context);
          if (Array.isArray(document.errors) && document.errors.length === 1
            && document.errors[0]?.code === 'MANIFEST_UNKNOWN') return null;
          fail(context, 'HTTP 404 without a MANIFEST_UNKNOWN error');
        }
        checkStatus(response, context);
        const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim();
        if (descriptor ? mediaType !== descriptor.mediaType : !indexTypes.includes(mediaType)) {
          discard(response);
          fail(context, 'unexpected manifest media type');
        }
        const { document, digest } = await readMetadata(response, context, {
          requireHeader: !descriptor && !isDigest(reference),
          digest: descriptor || isDigest(reference) ? reference : undefined,
          size: descriptor?.size,
        });
        if (document.schemaVersion !== 2 || (document.mediaType !== undefined && document.mediaType !== mediaType)) {
          fail(context, 'invalid manifest schema or media type');
        }
        if (descriptor && (!isDescriptor(document.config) || !Array.isArray(document.layers)
          || document.layers.length === 0 || !document.layers.every(isDescriptor))) {
          fail(context, 'invalid image config or layer descriptors');
        }
        return { document, digest };
      }

      async function configBlob(descriptor) {
        const context = `config ${descriptor.digest}`;
        const url = `${registry}${imagePath}/blobs/${descriptor.digest}`;
        let response = await request(url, context, { authorization });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          const target = location && URL.parse(location, url);
          discard(response);
          if (!target || target.origin !== blobOrigin || target.username || target.password) {
            fail(context, 'unsafe blob redirect');
          }
          // Signed GHCR storage URLs carry their own authorization.
          response = await request(target.href, context);
        }
        checkStatus(response, context);
        const { document } = await readMetadata(response, context, descriptor);
        return document;
      }

      const index = await manifest(ref);
      if (!index) return null;
      const { runnable, attestations } = classifyDescriptors(index.document.manifests, `index ${ref}`);
      for (const descriptor of attestations) {
        const context = `attestation ${descriptor.digest}`;
        const target = [...runnable.values()].find(({ digest }) => digest === descriptor.annotations['vnd.docker.reference.digest']);
        if (!target) fail(context, 'target does not match a runnable image');
        const { document } = await manifest(descriptor.digest, descriptor);
        verifyAttestation(document, target, context);
      }

      const platforms = await Promise.all(architectures.map(async architecture => {
        const descriptor = runnable.get(architecture);
        const context = `linux/${architecture}`;
        const { document } = await manifest(descriptor.digest, descriptor);
        const configType = descriptor.mediaType === ociManifest ? ociConfig : dockerConfig;
        if (document.artifactType !== undefined || document.subject !== undefined || document.config.mediaType !== configType
          || document.layers.some(({ mediaType }) => !layerTypes.has(mediaType))) {
          fail(context, 'unexpected runnable manifest contents');
        }
        const config = await configBlob(document.config);
        if (!checkPlatform(config) || config.architecture !== architecture
          || (config.variant !== undefined && descriptor.platform.variant !== undefined
            && config.variant !== descriptor.platform.variant)) {
          fail(context, 'image config platform differs from the index');
        }
        const rootfs = config.rootfs;
        if (rootfs?.type !== 'layers' || !Array.isArray(rootfs.diff_ids)
          || rootfs.diff_ids.length !== document.layers.length || !rootfs.diff_ids.every(isDigest)) {
          fail(context, 'invalid image config root filesystem');
        }
        const labels = config.config?.Labels;
        if (!isObject(labels) || !Object.values(labels).every(label => typeof label === 'string')) {
          fail(context, 'missing or invalid image config labels');
        }
        return { os: config.os, architecture, labels };
      }));
      return { digest: index.digest, platforms };
    },
  };
}

export function assertReleaseImage(info, { version, sourceCommit, digest } = {}) {
  if (typeof version !== 'string' || !versionPattern.test(version)
    || typeof sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
    fail('release image', 'expected a stable version and full source commit SHA');
  }
  if (!isDigest(info?.digest) || (digest !== undefined && info.digest !== digest)) {
    fail('release image', 'index digest does not match the expected release image');
  }
  if (!Array.isArray(info.platforms) || info.platforms.length !== architectures.length) {
    fail('release image', 'expected linux/amd64 and linux/arm64');
  }
  const expectedLabels = {
    'org.opencontainers.image.version': version,
    'org.opencontainers.image.revision': sourceCommit,
    'org.opencontainers.image.source': 'https://github.com/ill-yes/im-overdue',
    'org.opencontainers.image.licenses': 'PolyForm-Noncommercial-1.0.0',
  };
  for (const architecture of architectures) {
    const platform = info.platforms.find(entry => entry?.os === 'linux' && entry.architecture === architecture);
    if (!platform || !isObject(platform.labels)) fail('release image', `missing linux/${architecture} image config labels`);
    for (const [label, expected] of Object.entries(expectedLabels)) {
      if (platform.labels[label] !== expected) fail(`linux/${architecture}`, `unexpected ${label} label`);
    }
  }
}

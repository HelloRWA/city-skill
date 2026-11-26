import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isIsoDateTime, validateJsonSchema } from './lib/json-schema.mjs';

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIRECTORY = path.resolve(MODULE_DIRECTORY, '../schemas');
const CONTENT_ROOTS = ['places', 'templates'];
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.json', '.md', '.txt', '.svg']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const EXECUTABLE_EXTENSIONS = new Set([
  '.app', '.bash', '.bat', '.bin', '.cmd', '.com', '.cjs', '.dll', '.dylib',
  '.exe', '.fish', '.htm', '.html', '.jar', '.js', '.jsx', '.mjs', '.msi',
  '.php', '.pl', '.ps1', '.py', '.rb', '.run', '.sh', '.so', '.ts', '.tsx',
  '.vbs', '.wasm', '.zsh',
]);
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/i,
];
const GENERIC_SECRET = /(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|secret)["']?\s*[:=]\s*(?:["']([^"'\r\n]{8,})["']|([^\s#]{8,}))/i;
const DANGEROUS_URL = /(?:javascript|data|vbscript|file|blob|filesystem)\s*:/i;
const UNSAFE_URL = /(?:^|[\s("'`])((?:http|ftp):\/\/|\/\/)[^\s)"'`]*/i;
const EXECUTABLE_MARKDOWN = /```(?:bash|sh|shell|zsh|fish|powershell|ps1|javascript|js|typescript|ts|python|ruby|php)\b/i;
const DANGEROUS_HTML = /<\s*(?:script|iframe|object|embed)\b|\son[a-z-]+\s*=/i;

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function loadSchemas() {
  return {
    entity: JSON.parse(readFileSync(path.join(SCHEMA_DIRECTORY, 'entity.schema.json'), 'utf8')),
    source: JSON.parse(readFileSync(path.join(SCHEMA_DIRECTORY, 'source.schema.json'), 'utf8')),
    content: JSON.parse(readFileSync(path.join(SCHEMA_DIRECTORY, 'content-item.schema.json'), 'utf8')),
    skill: JSON.parse(readFileSync(path.join(SCHEMA_DIRECTORY, 'skill-manifest.schema.json'), 'utf8')),
  };
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function hasEncodedTraversal(value) {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return true;
    }
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.startsWith('/')) return true;
    if (decoded.split('/').some((segment) => segment === '..')) return true;
  }
  return false;
}

export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || hasEncodedTraversal(value)) return false;
  if (value.split('/').some((segment) => segment === '..' || segment === '')) return false;
  return path.posix.normalize(value) === value;
}

function isPlaceholderSecret(value) {
  return /(?:replace|placeholder|example|dummy|not-a-real|user-provided|your[_-]|^x+$)/i.test(value);
}

function isExecutableMagic(buffer) {
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString() === 'MZ') return true;
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('hex') === '7f454c46') return true;
  if (buffer.length >= 4) {
    const magic = buffer.subarray(0, 4).toString('hex');
    if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(magic)) return true;
  }
  return false;
}

/**
 * Validate a checkout without executing any contributed content.
 * Returns diagnostics rather than throwing so CI and tests can inspect all errors.
 */
export function validateRepository(rootDirectory = process.cwd()) {
  const root = path.resolve(rootDirectory);
  const schemas = loadSchemas();
  const errors = [];
  const files = [];
  const fileByRelativePath = new Map();
  const jsonByRelativePath = new Map();

  const add = (code, file, message, jsonPath = '') => {
    errors.push({ code, file: file || '.', path: jsonPath, message });
  };

  const walk = (absoluteDirectory, relativeDirectory) => {
    if (files.length >= MAX_FILES) {
      add('TOO_MANY_FILES', relativeDirectory, `content contains more than ${MAX_FILES} files`);
      return;
    }
    let entries;
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      add('FILE_READ_ERROR', relativeDirectory, error.message);
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(absoluteDirectory, entry.name);
      const relative = `${relativeDirectory}/${entry.name}`;
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch (error) {
        add('FILE_READ_ERROR', relative, error.message);
        continue;
      }
      if (stat.isSymbolicLink()) {
        add('SYMLINK_NOT_ALLOWED', relative, 'symbolic links are not accepted');
        continue;
      }
      if (stat.isDirectory()) {
        walk(absolute, relative);
        continue;
      }
      if (!stat.isFile()) {
        add('UNSUPPORTED_FILE', relative, 'only regular files and directories are accepted');
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        add('FILE_TOO_LARGE', relative, `file exceeds ${MAX_FILE_BYTES} bytes`);
        continue;
      }
      const record = { absolute, relative, size: stat.size };
      files.push(record);
      fileByRelativePath.set(relative, record);

      const extension = path.extname(entry.name).toLowerCase();
      if (extension === '.yaml' || extension === '.yml') {
        add('JSON_ONLY', relative, 'machine data must use JSON; YAML is not supported');
        continue;
      }
      if (EXECUTABLE_EXTENSIONS.has(extension)) {
        add('EXECUTABLE_CONTENT', relative, `executable or active content extension ${extension} is not allowed`);
        continue;
      }
      if (!TEXT_EXTENSIONS.has(extension) && !IMAGE_EXTENSIONS.has(extension)) {
        add('UNSUPPORTED_FILE', relative, `unsupported content file type ${extension || '(none)'}`);
        continue;
      }

      const buffer = readFileSync(absolute);
      if (isExecutableMagic(buffer)) {
        add('EXECUTABLE_CONTENT', relative, 'executable binary signature detected');
        continue;
      }
      if (!TEXT_EXTENSIONS.has(extension)) continue;
      const text = buffer.toString('utf8');
      if (text.includes('\0')) {
        add('UNSUPPORTED_FILE', relative, 'binary content in a text file is not allowed');
        continue;
      }

      if (extension === '.json') {
        try {
          jsonByRelativePath.set(relative, JSON.parse(text));
        } catch (error) {
          add('INVALID_JSON', relative, error.message);
        }
      }

      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(text)) {
          add('SECRET_DETECTED', relative, `possible credential matches ${pattern}`);
          break;
        }
      }
      const genericSecret = text.match(GENERIC_SECRET);
      if (genericSecret && !isPlaceholderSecret(genericSecret[1] ?? genericSecret[2] ?? '')) {
        add('SECRET_DETECTED', relative, 'possible credential in a secret/token/password assignment');
      }
      if (DANGEROUS_URL.test(text)) {
        add('DANGEROUS_URL', relative, 'active-content or local-file URL scheme detected');
      }
      if (UNSAFE_URL.test(text)) {
        add('UNSAFE_URL', relative, 'external links must use HTTPS, not HTTP/FTP or protocol-relative URLs');
      }
      if (DANGEROUS_HTML.test(text)) {
        add('EXECUTABLE_CONTENT', relative, 'script-capable HTML or event handlers are not allowed');
      }
      if (extension === '.md' && EXECUTABLE_MARKDOWN.test(text)) {
        add('EXECUTABLE_CONTENT', relative, 'executable-language code fences are not allowed in contributed Markdown');
      }
    }
  };

  for (const contentRoot of CONTENT_ROOTS) {
    const absolute = path.join(root, contentRoot);
    if (!existsSync(absolute)) continue;
    if (!statSync(absolute).isDirectory()) {
      add('INVALID_CONTENT_ROOT', contentRoot, 'content root must be a directory');
      continue;
    }
    walk(absolute, contentRoot);
  }

  const runSchema = (schemaName, value, file) => {
    for (const error of validateJsonSchema(value, schemas[schemaName])) {
      add('SCHEMA_VALIDATION', file, `${error.path} ${error.message}`, error.path);
    }
  };

  const entityRecords = files
    .filter((file) => file.relative.endsWith('/entity.json'))
    .map((file) => ({
      file: file.relative,
      absolute: file.absolute,
      directory: path.dirname(file.absolute),
      relativeDirectory: path.posix.dirname(file.relative),
      data: jsonByRelativePath.get(file.relative),
      sources: [],
      contentItems: [],
    }));

  const entityById = new Map();
  for (const record of entityRecords) {
    if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) continue;
    runSchema('entity', record.data, record.file);
    const id = record.data.id;
    if (typeof id === 'string') {
      if (entityById.has(id)) {
        add('DUPLICATE_ID', record.file, `entity ID ${id} is also declared in ${entityById.get(id).file}`, '$.id');
      } else {
        entityById.set(id, record);
      }
    }

    const sourceFile = `${record.relativeDirectory}/data/sources.json`;
    if (fileByRelativePath.has(sourceFile)) {
      const sourceData = jsonByRelativePath.get(sourceFile);
      if (!Array.isArray(sourceData)) {
        if (sourceData !== undefined) add('SCHEMA_VALIDATION', sourceFile, 'sources.json must contain an array');
      } else {
        record.sources = sourceData.map((data, index) => ({ data, file: sourceFile, index, entity: record }));
      }
    }
    const contentFile = `${record.relativeDirectory}/data/content.json`;
    if (fileByRelativePath.has(contentFile)) {
      const contentData = jsonByRelativePath.get(contentFile);
      if (!Array.isArray(contentData)) {
        if (contentData !== undefined) add('SCHEMA_VALIDATION', contentFile, 'content.json must contain an array');
      } else {
        record.contentItems = contentData.map((data, index) => ({ data, file: contentFile, index, entity: record }));
      }
    }
  }

  const sourceById = new Map();
  const contentById = new Map();
  for (const record of entityRecords) {
    for (const source of record.sources) {
      runSchema('source', source.data, source.file);
      if (typeof source.data?.id === 'string') {
        if (sourceById.has(source.data.id)) {
          add('DUPLICATE_SOURCE_ID', source.file, `duplicate source ID ${source.data.id}`, `$.[${source.index}].id`);
        } else {
          sourceById.set(source.data.id, source);
        }
      }
    }
    for (const content of record.contentItems) {
      runSchema('content', content.data, content.file);
      if (typeof content.data?.id === 'string') {
        if (contentById.has(content.data.id)) {
          add('DUPLICATE_CONTENT_ID', content.file, `duplicate content ID ${content.data.id}`, `$.[${content.index}].id`);
        } else {
          contentById.set(content.data.id, content);
        }
      }
    }
  }

  const checkCoordinate = (coordinate, file, jsonPath) => {
    if (!coordinate || typeof coordinate !== 'object') return;
    if (!Number.isFinite(coordinate.lat) || coordinate.lat < -90 || coordinate.lat > 90) {
      add('COORDINATE_RANGE', file, `${jsonPath}.lat must be a finite number in [-90, 90]`, `${jsonPath}.lat`);
    }
    if (!Number.isFinite(coordinate.lng) || coordinate.lng < -180 || coordinate.lng > 180) {
      add('COORDINATE_RANGE', file, `${jsonPath}.lng must be a finite number in [-180, 180]`, `${jsonPath}.lng`);
    }
  };

  const checkReference = (record, referencePath, file, jsonPath, allowedPrefix = /^(?:references|data)\//) => {
    if (!isSafeRelativePath(referencePath)) {
      add('UNSAFE_PATH', file, `unsafe relative path: ${referencePath}`, jsonPath);
      return false;
    }
    if (!allowedPrefix.test(referencePath)) {
      add('UNSAFE_PATH', file, `path must be below the declared content directory: ${referencePath}`, jsonPath);
      return false;
    }
    const resolved = path.resolve(record.directory, ...referencePath.split('/'));
    if (!resolved.startsWith(`${path.resolve(record.directory)}${path.sep}`)) {
      add('UNSAFE_PATH', file, `path escapes entity directory: ${referencePath}`, jsonPath);
      return false;
    }
    const relative = `${record.relativeDirectory}/${referencePath}`;
    if (!fileByRelativePath.has(relative)) {
      add('REFERENCE_NOT_FOUND', file, `referenced file does not exist: ${referencePath}`, jsonPath);
      return false;
    }
    return true;
  };

  for (const record of entityRecords) {
    const entity = record.data;
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) continue;
    const location = entity.location;
    if (location && typeof location === 'object') {
      if (location.center !== null) checkCoordinate(location.center, record.file, '$.location.center');
      if (Array.isArray(location.bbox)) {
        const [west, south, east, north] = location.bbox;
        checkCoordinate({ lat: south, lng: west }, record.file, '$.location.bbox.southWest');
        checkCoordinate({ lat: north, lng: east }, record.file, '$.location.bbox.northEast');
        if (Number.isFinite(west) && Number.isFinite(east) && west >= east) {
          add('BBOX_ORDER', record.file, 'bbox west must be less than east', '$.location.bbox');
        }
        if (Number.isFinite(south) && Number.isFinite(north) && south >= north) {
          add('BBOX_ORDER', record.file, 'bbox south must be less than north', '$.location.bbox');
        }
        if (location.center && Number.isFinite(west) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(north)) {
          if (location.center.lng < west || location.center.lng > east || location.center.lat < south || location.center.lat > north) {
            add('BBOX_CENTER', record.file, 'center must be inside bbox', '$.location.center');
          }
        }
      }
      location.entrances?.forEach?.((entrance, index) => checkCoordinate(entrance, record.file, `$.location.entrances[${index}]`));
    }
    if (entity.status === 'published') {
      if (location?.center === null || location?.center === undefined) {
        add('MARKER_COORDINATES_REQUIRED', record.file, 'published entities require reviewed center coordinates', '$.location.center');
      }
      if (entity.verification?.status === 'unverified') {
        add('PUBLISHED_UNVERIFIED', record.file, 'published entity verification status cannot be unverified', '$.verification.status');
      }
      if (!Array.isArray(entity.sources) || entity.sources.length === 0) {
        add('SOURCE_REQUIRED', record.file, 'published entities require at least one source', '$.sources');
      }
    }

    const verification = entity.verification;
    if (verification && typeof verification === 'object') {
      if (verification.official !== (verification.status === 'official-verified')) {
        add('OFFICIAL_STATUS_MISMATCH', record.file, 'official=true is valid only with status=official-verified, and vice versa', '$.verification');
      }
      if (verification.status === 'official-verified') {
        if (!verification.method?.trim() || !isIsoDateTime(verification.verifiedAt) || !verification.reviewedBy?.trim() || !isHttpsUrl(verification.evidenceUrl)) {
          add('OFFICIAL_EVIDENCE_REQUIRED', record.file, 'official verification requires method, reviewer, ISO verifiedAt and HTTPS evidenceUrl', '$.verification');
        }
      }
    }

    if (entity.cover !== null && entity.cover !== undefined) {
      checkReference(record, entity.cover, record.file, '$.cover', /^assets\//);
    }

    const sourceIds = new Set(Array.isArray(entity.sources) ? entity.sources : []);
    for (const [index, sourceId] of sourceIds.entries()) {
      const source = sourceById.get(sourceId);
      if (!source) {
        add('SOURCE_NOT_FOUND', record.file, `unknown source ID ${sourceId}`, `$.sources[${index}]`);
      } else if (entity.status === 'published' && source.data.verificationStatus !== 'verified') {
        add('SOURCE_NOT_VERIFIED', record.file, `published entity uses unverified/stale source ${sourceId}`, `$.sources[${index}]`);
      }
    }

    const manifestFile = `${record.relativeDirectory}/skill.json`;
    const skillFile = `${record.relativeDirectory}/SKILL.md`;
    const manifest = jsonByRelativePath.get(manifestFile);
    if (!fileByRelativePath.has(manifestFile)) {
      add('SKILL_MANIFEST_NOT_FOUND', record.file, 'skill.json is required', '$.skill.manifest');
    } else if (manifest !== undefined) {
      runSchema('skill', manifest, manifestFile);
    }
    if (!fileByRelativePath.has(skillFile)) {
      add('SKILL_ENTRY_NOT_FOUND', record.file, 'SKILL.md is required', '$.skill.entry');
    }

    const entityReferences = Array.isArray(entity.content?.refs) ? entity.content.refs : [];
    const referencePaths = new Set();
    entityReferences.forEach((reference, index) => {
      if (!reference || typeof reference !== 'object') return;
      if (referencePaths.has(reference.path)) {
        add('DUPLICATE_REFERENCE', record.file, `duplicate reference path ${reference.path}`, `$.content.refs[${index}]`);
      }
      referencePaths.add(reference.path);
      checkReference(record, reference.path, record.file, `$.content.refs[${index}].path`);
    });

    if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
      if (manifest.id !== entity.id || manifest.entityId !== entity.id) {
        add('SKILL_ENTITY_MISMATCH', manifestFile, `manifest id/entityId must both equal ${entity.id}`, '$.entityId');
      }
      if (manifest.entry !== entity.skill?.entry || entity.skill?.manifest !== 'skill.json') {
        add('SKILL_ENTRY_MISMATCH', manifestFile, 'manifest and entity must use SKILL.md and skill.json', '$.entry');
      }
      const manifestPaths = new Set();
      manifest.references?.forEach?.((reference, index) => {
        if (!reference || typeof reference !== 'object') return;
        if (manifestPaths.has(reference.path)) {
          add('DUPLICATE_REFERENCE', manifestFile, `duplicate reference path ${reference.path}`, `$.references[${index}]`);
        }
        manifestPaths.add(reference.path);
        checkReference(record, reference.path, manifestFile, `$.references[${index}].path`);
      });
      for (const reference of entityReferences) {
        const match = manifest.references?.find?.((candidate) => candidate.path === reference.path);
        if (!match || match.title !== reference.title || match.kind !== reference.kind) {
          add('SKILL_REFERENCE_MISMATCH', manifestFile, `reference ${reference.path} must match entity title/kind/path`, '$.references');
        }
      }
      for (const reference of manifest.references ?? []) {
        if (!referencePaths.has(reference.path)) {
          add('SKILL_REFERENCE_MISMATCH', record.file, `manifest reference ${reference.path} is missing from entity content.refs`, '$.content.refs');
        }
      }
      manifest.mcp?.externalServers?.forEach?.((server, index) => {
        if (!isHttpsUrl(server.url)) {
          add('UNSAFE_URL', manifestFile, 'external MCP server URL must be credential-free HTTPS', `$.mcp.externalServers[${index}].url`);
        }
      });
    }

    if (fileByRelativePath.has(skillFile)) {
      const skillText = readFileSync(path.join(root, ...skillFile.split('/')), 'utf8');
      if (/^---\s*\r?\n/.test(skillText)) {
        add('JSON_ONLY', skillFile, 'SKILL.md uses a JSON binding comment, not YAML front matter');
      }
      const metadataMatches = [...skillText.matchAll(/<!--\s*city-skill:\s*(\{[^\r\n]*\})\s*-->/g)];
      if (metadataMatches.length !== 1) {
        add('SKILL_METADATA_MISMATCH', skillFile, 'SKILL.md requires exactly one single-line city-skill JSON binding comment');
      } else {
        try {
          const metadata = JSON.parse(metadataMatches[0][1]);
          if (metadata.entityId !== entity.id || metadata.manifest !== 'skill.json' || Object.keys(metadata).sort().join(',') !== 'entityId,manifest') {
            add('SKILL_METADATA_MISMATCH', skillFile, `binding must contain only entityId=${entity.id} and manifest=skill.json`);
          }
        } catch (error) {
          add('SKILL_METADATA_MISMATCH', skillFile, `invalid binding JSON: ${error.message}`);
        }
      }

      const markdownPaths = new Set();
      for (const match of skillText.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
        const destination = match[1];
        if (/^https:/i.test(destination) || destination.startsWith('#')) continue;
        const localPath = destination.split('#')[0];
        if (!localPath) continue;
        if (!checkReference(record, localPath, skillFile, 'SKILL.md link', /^(?:references|data|assets)\//)) continue;
        markdownPaths.add(localPath);
      }
      for (const referencePath of referencePaths) {
        if (isSafeRelativePath(referencePath) && !markdownPaths.has(referencePath)) {
          add('SKILL_REFERENCE_MISMATCH', skillFile, `SKILL.md must link declared reference ${referencePath}`);
        }
      }
      for (const markdownPath of markdownPaths) {
        if (/^(?:references|data)\//.test(markdownPath) && !referencePaths.has(markdownPath)) {
          add('SKILL_REFERENCE_MISMATCH', skillFile, `linked content ${markdownPath} is not declared in manifest/entity references`);
        }
      }
    }
  }

  for (const source of sourceById.values()) {
    const data = source.data;
    if (!isIsoDateTime(data.checkedAt)) {
      add('SOURCE_CHECKED_AT', source.file, `source ${data.id} requires a valid checkedAt date-time`, `$.[${source.index}].checkedAt`);
    }
    if (!data.materialId?.trim() && !data.url?.trim()) {
      add('SOURCE_LOCATOR_REQUIRED', source.file, `source ${data.id} requires materialId or url`, `$.[${source.index}]`);
    }
    if (!data.locator?.page?.trim() && !data.locator?.chapter?.trim()) {
      add('SOURCE_LOCATOR_REQUIRED', source.file, `source ${data.id} requires a page or chapter`, `$.[${source.index}].locator`);
    }
    if (data.url && !isHttpsUrl(data.url)) {
      add('UNSAFE_URL', source.file, `source ${data.id} url must be credential-free HTTPS`, `$.[${source.index}].url`);
    }
    if (data.officialUrl && !isHttpsUrl(data.officialUrl)) {
      add('UNSAFE_URL', source.file, `source ${data.id} officialUrl must be credential-free HTTPS`, `$.[${source.index}].officialUrl`);
    }
    if (data.verificationStatus === 'verified' && (!isIsoDateTime(data.verifiedAt) || !data.verifiedBy?.trim())) {
      add('SOURCE_VERIFICATION_REQUIRED', source.file, `verified source ${data.id} requires verifiedAt and verifiedBy`, `$.[${source.index}]`);
    }
  }

  for (const content of contentById.values()) {
    const data = content.data;
    const entity = content.entity.data;
    const jsonBase = `$.[${content.index}]`;
    if (data.entityId !== entity.id) {
      add('CONTENT_ENTITY_MISMATCH', content.file, `content ${data.id} entityId must equal ${entity.id}`, `${jsonBase}.entityId`);
    }
    if (!isIsoDateTime(data.checkedAt)) {
      add('CONTENT_CHECKED_AT', content.file, `content ${data.id} requires a valid checkedAt date-time`, `${jsonBase}.checkedAt`);
    }
    const declaredSources = new Set(Array.isArray(entity.sources) ? entity.sources : []);
    const source = sourceById.get(data.sourceId);
    if (!source) {
      add('SOURCE_NOT_FOUND', content.file, `content ${data.id} references unknown source ${data.sourceId}`, `${jsonBase}.sourceId`);
    }
    if (!declaredSources.has(data.sourceId)) {
      add('CONTENT_SOURCE_NOT_DECLARED', content.file, `content source ${data.sourceId} must be listed in entity.sources`, `${jsonBase}.sourceId`);
    }
    if (data.status === 'published') {
      if (entity.status !== 'published') {
        add('CONTENT_PARENT_NOT_PUBLISHED', content.file, `published content ${data.id} belongs to a non-published entity`, `${jsonBase}.status`);
      }
      if (data.verificationStatus !== 'verified' || source?.data.verificationStatus !== 'verified') {
        add('CONTENT_NOT_VERIFIED', content.file, `published content ${data.id} and its source must both be verified`, `${jsonBase}`);
      }
    }

    for (const [fieldName, field] of Object.entries(data.dynamicFields ?? {})) {
      const fieldPath = `${jsonBase}.dynamicFields.${fieldName}`;
      if (!isIsoDateTime(field.checkedAt)) {
        add('DYNAMIC_CHECKED_AT', content.file, `${fieldName} requires a valid checkedAt`, `${fieldPath}.checkedAt`);
      }
      if (!isHttpsUrl(field.officialUrl)) {
        add('DYNAMIC_OFFICIAL_URL', content.file, `${fieldName} requires a credential-free HTTPS officialUrl`, `${fieldPath}.officialUrl`);
      }
      const fieldSource = sourceById.get(field.sourceId);
      if (!fieldSource) {
        add('SOURCE_NOT_FOUND', content.file, `${fieldName} references unknown source ${field.sourceId}`, `${fieldPath}.sourceId`);
      }
      if (!declaredSources.has(field.sourceId)) {
        add('CONTENT_SOURCE_NOT_DECLARED', content.file, `${fieldName} source must be listed in entity.sources`, `${fieldPath}.sourceId`);
      }
      if (data.status === 'published' && fieldSource?.data.verificationStatus !== 'verified') {
        add('CONTENT_NOT_VERIFIED', content.file, `${fieldName} must use a verified source`, `${fieldPath}.sourceId`);
      }
      if (field.validUntil !== null && field.validUntil !== undefined) {
        if (!isIsoDateTime(field.validUntil)) {
          add('DYNAMIC_VALID_UNTIL', content.file, `${fieldName} validUntil must be null or an ISO date-time`, `${fieldPath}.validUntil`);
        } else if (isIsoDateTime(field.checkedAt) && Date.parse(field.validUntil) < Date.parse(field.checkedAt)) {
          add('DYNAMIC_VALID_UNTIL', content.file, `${fieldName} validUntil cannot precede checkedAt`, `${fieldPath}.validUntil`);
        }
      }
    }
  }

  for (const record of entityRecords) {
    const entity = record.data;
    if (!entity || !entity.id) continue;
    const parentId = entity.parentId;
    if (entity.type === 'city') {
      if (parentId !== null) add('PARENT_TYPE', record.file, 'city parentId must be null', '$.parentId');
      continue;
    }
    if (typeof parentId !== 'string' || !parentId) {
      add('PARENT_REQUIRED', record.file, `${entity.type} requires a parentId`, '$.parentId');
      continue;
    }
    const parent = entityById.get(parentId);
    if (!parent) {
      add('PARENT_NOT_FOUND', record.file, `parent ${parentId} does not exist`, '$.parentId');
      continue;
    }
    const valid = entity.type === 'district'
      ? parent.data.type === 'city'
      : ['city', 'district'].includes(parent.data.type);
    if (!valid) {
      add('PARENT_TYPE', record.file, `${entity.type} has invalid parent type ${parent.data.type}`, '$.parentId');
    }
  }

  const visitState = new Map();
  const stack = [];
  const visit = (record) => {
    const state = visitState.get(record) ?? 0;
    if (state === 2) return;
    if (state === 1) {
      const start = stack.indexOf(record);
      const cycle = [...stack.slice(start), record].map((item) => item.data.id).join(' -> ');
      add('PARENT_CYCLE', record.file, `parent cycle detected: ${cycle}`, '$.parentId');
      return;
    }
    visitState.set(record, 1);
    stack.push(record);
    const parent = entityById.get(record.data.parentId);
    if (parent) visit(parent);
    stack.pop();
    visitState.set(record, 2);
  };
  entityRecords.forEach(visit);

  errors.sort((left, right) => `${left.file}:${left.code}:${left.path}`.localeCompare(`${right.file}:${right.code}:${right.path}`));
  return {
    valid: errors.length === 0,
    errors,
    model: {
      root,
      entities: entityRecords,
      sources: [...sourceById.values()],
      contentItems: [...contentById.values()],
    },
  };
}

export function formatValidationErrors(errors) {
  return errors.map((error) => `${error.file}${error.path ? ` ${error.path}` : ''}: [${error.code}] ${error.message}`).join('\n');
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: process.cwd() },
    },
  });
  const result = validateRepository(values.root);
  if (!result.valid) {
    console.error(formatValidationErrors(result.errors));
    console.error(`\nValidation failed with ${result.errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }
  const published = result.model.entities.filter((entity) => entity.relativeDirectory.startsWith('places/') && entity.data.status === 'published').length;
  console.log(`Validation passed: ${result.model.entities.length} entities, ${result.model.sources.length} sources, ${result.model.contentItems.length} content items (${published} published places).`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}

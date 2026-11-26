import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatValidationErrors,
  isSafeRelativePath,
  validateRepository,
} from '../scripts/validate.mjs';
import { buildRegistry, writeRegistry } from '../scripts/build-registry.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '..');
const VALID_FIXTURE = path.join(TEST_DIRECTORY, 'fixtures', 'valid');
const CITY = 'places/test/fixture-city';
const DISTRICT = 'places/test/fixture-city/districts/fixture-district';
const ATTRACTION = 'places/test/fixture-city/attractions/fixture-attraction';

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'city-skill-test-'));
  cpSync(VALID_FIXTURE, directory, { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function readJson(root, relative) {
  return JSON.parse(readFileSync(path.join(root, ...relative.split('/')), 'utf8'));
}

function writeJson(root, relative, value) {
  writeFileSync(path.join(root, ...relative.split('/')), `${JSON.stringify(value, null, 2)}\n`);
}

function mutateJson(root, relative, mutate) {
  const value = readJson(root, relative);
  mutate(value);
  writeJson(root, relative, value);
}

function expectFailure(root, code) {
  const result = validateRepository(root);
  assert.equal(result.valid, false, `expected ${code}, but fixture was valid`);
  assert.ok(
    result.errors.some((error) => error.code === code),
    `expected ${code}; received:\n${formatValidationErrors(result.errors)}`,
  );
  return result;
}

test('valid three-level fixture and dynamic metadata pass', () => {
  const result = validateRepository(VALID_FIXTURE);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.equal(result.model.entities.length, 3);
  assert.equal(result.model.sources.length, 3);
  const attraction = result.model.contentItems.find((item) => item.data.id === 'content-fixture-attraction');
  assert.equal(attraction.data.dynamicFields.price.checkedAt, '2026-01-15T00:00:00Z');
});

test('repository templates remain drafts and published reference content passes', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  assert.deepEqual(result.errors, []);
  const templates = result.model.entities.filter((entity) => entity.relativeDirectory.startsWith('templates/'));
  assert.equal(templates.length, 3);
  assert.ok(templates.every((entity) => entity.data.status === 'draft'));
  assert.deepEqual(
    result.model.entities
      .filter((entity) => entity.data.status === 'published')
      .map((entity) => entity.data.id),
    [
      'cn-hubei-wuhan-east-lake-scenic-area',
      'cn-hubei-wuhan-yellow-crane-tower',
      'cn-hubei-wuhan-wuchang',
      'cn-hubei-wuhan'
    ]
  );
  const registry = buildRegistry(REPOSITORY_ROOT);
  assert.equal(registry.stats.entities, 4);
  assert.equal(registry.stats.sources, 13);
  assert.equal(registry.stats.officialEntities, 0);
  assert.equal(registry.stats.sourceCoverage, 1);
});

test('registry build is deterministic and contains only published fixture content', (t) => {
  const root = fixture(t);
  const first = writeRegistry(root, 'registry.json', { commit: 'test-commit' });
  const second = writeRegistry(root, 'second.json', { commit: 'test-commit' });
  assert.equal(readFileSync(first.destination, 'utf8'), readFileSync(second.destination, 'utf8'));
  assert.equal(first.registry.repositoryCommit, 'test-commit');
  assert.equal(first.registry.stats.cities, 1);
  assert.equal(first.registry.stats.districts, 1);
  assert.equal(first.registry.stats.attractions, 1);
  assert.equal(first.registry.stats.sourceCoverage, 1);
  assert.deepEqual(first.registry.entities.map((entity) => entity.id), [
    'fixture-attraction',
    'fixture-city',
    'fixture-district',
  ]);
});

test('failure: duplicate entity ID', (t) => {
  const root = fixture(t);
  cpSync(path.join(root, CITY), path.join(root, 'places/test/duplicate-city'), { recursive: true });
  const result = expectFailure(root, 'DUPLICATE_ID');
  assert.throws(() => buildRegistry(root), /DUPLICATE_ID/);
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_SOURCE_ID'));
});

test('failure: missing parent', (t) => {
  const root = fixture(t);
  mutateJson(root, `${DISTRICT}/entity.json`, (entity) => { entity.parentId = 'missing-city'; });
  expectFailure(root, 'PARENT_NOT_FOUND');
});

test('failure: parent cycle', (t) => {
  const root = fixture(t);
  mutateJson(root, `${CITY}/entity.json`, (entity) => { entity.parentId = 'fixture-attraction'; });
  expectFailure(root, 'PARENT_CYCLE');
});

test('failure: out-of-range coordinates and entrance coordinates', (t) => {
  const root = fixture(t);
  mutateJson(root, `${CITY}/entity.json`, (entity) => { entity.location.center.lat = 91; });
  mutateJson(root, `${ATTRACTION}/entity.json`, (entity) => { entity.location.entrances[0].lng = 181; });
  const result = expectFailure(root, 'COORDINATE_RANGE');
  assert.ok(result.errors.filter((error) => error.code === 'COORDINATE_RANGE').length >= 2);
});

test('failure: reference path traversal, including encoded traversal', (t) => {
  const root = fixture(t);
  mutateJson(root, `${CITY}/skill.json`, (manifest) => { manifest.references[0].path = '../outside.md'; });
  expectFailure(root, 'UNSAFE_PATH');
  assert.equal(isSafeRelativePath('references/overview.md'), true);
  assert.equal(isSafeRelativePath('%2e%2e/outside.md'), false);
  assert.equal(isSafeRelativePath('/etc/passwd'), false);
  assert.equal(isSafeRelativePath('references\\..\\outside.md'), false);
});

test('failure: declared reference does not exist', (t) => {
  const root = fixture(t);
  unlinkSync(path.join(root, CITY, 'references/overview.md'));
  expectFailure(root, 'REFERENCE_NOT_FOUND');
});

test('failure: missing source', (t) => {
  const root = fixture(t);
  mutateJson(root, `${CITY}/entity.json`, (entity) => { entity.sources = ['src-does-not-exist']; });
  expectFailure(root, 'SOURCE_NOT_FOUND');
});

test('failure: SKILL.md binding disagrees with entity/manifest', (t) => {
  const root = fixture(t);
  const skillPath = path.join(root, CITY, 'SKILL.md');
  const text = readFileSync(skillPath, 'utf8');
  writeFileSync(skillPath, text.replace('{"entityId":"fixture-city","manifest":"skill.json"}', '{"entityId":"another-city","manifest":"skill.json"}'));
  expectFailure(root, 'SKILL_METADATA_MISMATCH');
});

test('failure: manifest and entity references disagree', (t) => {
  const root = fixture(t);
  mutateJson(root, `${CITY}/skill.json`, (manifest) => { manifest.references[0].title = 'Different title'; });
  expectFailure(root, 'SKILL_REFERENCE_MISMATCH');
});

test('failure: secret or token in contributed content', (t) => {
  const root = fixture(t);
  const reference = path.join(root, CITY, 'references/overview.md');
  writeFileSync(reference, `${readFileSync(reference, 'utf8')}\napi_key = "sk-live-abcdefghijklmnopqrstuvwxyz"\n`);
  expectFailure(root, 'SECRET_DETECTED');
});

test('failure: dangerous active-content URL', (t) => {
  const root = fixture(t);
  mutateJson(root, `${CITY}/entity.json`, (entity) => { entity.summary = '[run](javascript:alert(1))'; });
  expectFailure(root, 'DANGEROUS_URL');
});

test('failure: self-declared official status without manual verification state', (t) => {
  const root = fixture(t);
  mutateJson(root, `${CITY}/entity.json`, (entity) => { entity.verification.official = true; });
  expectFailure(root, 'OFFICIAL_STATUS_MISMATCH');
});

test('failure: source checkedAt is required and must be ISO date-time', (t) => {
  const root = fixture(t);
  mutateJson(root, `${CITY}/data/sources.json`, (sources) => { delete sources[0].checkedAt; });
  const result = expectFailure(root, 'SOURCE_CHECKED_AT');
  assert.ok(result.errors.some((error) => error.code === 'SCHEMA_VALIDATION'));
});

test('failure: executable content is rejected', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, CITY, 'references/payload.sh'), '#!/bin/sh\necho blocked\n');
  expectFailure(root, 'EXECUTABLE_CONTENT');
});

test('failure: published content cannot use an unverified source', (t) => {
  const root = fixture(t);
  mutateJson(root, `${CITY}/data/sources.json`, (sources) => { sources[0].verificationStatus = 'unverified'; });
  const result = expectFailure(root, 'SOURCE_NOT_VERIFIED');
  assert.ok(result.errors.some((error) => error.code === 'CONTENT_NOT_VERIFIED'));
});

test('failure: dynamic facts require an HTTPS official URL', (t) => {
  const root = fixture(t);
  mutateJson(root, `${ATTRACTION}/data/content.json`, (items) => { items[0].dynamicFields.price.officialUrl = 'http://example.com/price'; });
  const result = expectFailure(root, 'DYNAMIC_OFFICIAL_URL');
  assert.ok(result.errors.some((error) => error.code === 'UNSAFE_URL'));
});

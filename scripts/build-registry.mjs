import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { formatValidationErrors, validateRepository } from './validate.mjs';

function byId(left, right) {
  return left.id.localeCompare(right.id);
}

export function buildRegistry(rootDirectory = process.cwd(), { commit = null } = {}) {
  const validation = validateRepository(rootDirectory);
  if (!validation.valid) {
    throw new Error(`Registry build stopped because validation failed:\n${formatValidationErrors(validation.errors)}`);
  }

  const publishedEntities = validation.model.entities
    .filter((record) => record.relativeDirectory.startsWith('places/') && record.data.status === 'published')
    .sort((left, right) => left.data.id.localeCompare(right.data.id));
  const publishedIds = new Set(publishedEntities.map((record) => record.data.id));
  const sourceIds = new Set(publishedEntities.flatMap((record) => record.data.sources));

  const sources = validation.model.sources
    .filter((source) => sourceIds.has(source.data.id))
    .map((source) => structuredClone(source.data))
    .sort(byId);
  const contentItems = validation.model.contentItems
    .filter((content) => publishedIds.has(content.entity.data.id) && content.data.status === 'published')
    .map((content) => structuredClone(content.data))
    .sort(byId);

  const entities = publishedEntities.map((record) => {
    const entity = record.data;
    const manifestFile = `${record.relativeDirectory}/skill.json`;
    const manifest = JSON.parse(readText(validation.model.root, manifestFile));
    return {
      id: entity.id,
      type: entity.type,
      parentId: entity.parentId,
      path: record.relativeDirectory,
      name: entity.name,
      aliases: structuredClone(entity.aliases),
      admin: structuredClone(entity.admin),
      location: structuredClone(entity.location),
      summary: entity.summary,
      cover: entity.cover,
      verification: structuredClone(entity.verification),
      maintainers: structuredClone(entity.maintainers),
      sources: [...entity.sources].sort(),
      content: structuredClone(entity.content),
      skill: {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        entry: manifest.entry,
        manifest: 'skill.json',
        scope: structuredClone(manifest.scope),
        mcp: structuredClone(manifest.mcp),
        references: structuredClone(manifest.references),
        output: structuredClone(manifest.output),
      },
    };
  });

  const countType = (type) => entities.filter((entity) => entity.type === type).length;
  const sourcedContent = contentItems.filter((content) => content.sourceId).length;
  const checkedDates = sources.map((source) => source.checkedAt).filter(Boolean).sort();

  return {
    schemaVersion: 1,
    repository: 'HelloRWA/city-skill',
    repositoryCommit: commit,
    entities,
    sources,
    contentItems,
    stats: {
      entities: entities.length,
      cities: countType('city'),
      districts: countType('district'),
      attractions: countType('attraction'),
      officialEntities: entities.filter((entity) => entity.verification.official).length,
      contentItems: contentItems.length,
      sources: sources.length,
      sourceCoverage: contentItems.length === 0 ? 0 : sourcedContent / contentItems.length,
      latestSourceCheckedAt: checkedDates.at(-1) ?? null,
    },
  };
}

function readText(root, relativePath) {
  // The path comes from a validated entity record, never directly from user input.
  return readFileSync(path.join(root, ...relativePath.split('/')), 'utf8');
}

export function writeRegistry(rootDirectory, outputPath, options = {}) {
  const root = path.resolve(rootDirectory);
  const destination = path.isAbsolute(outputPath) ? outputPath : path.join(root, outputPath);
  const registry = buildRegistry(root, options);
  const serialized = `${JSON.stringify(registry, null, 2)}\n`;
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o644 });
  renameSync(temporary, destination);
  return { registry, destination, bytes: Buffer.byteLength(serialized) };
}

function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: process.cwd() },
      output: { type: 'string', default: 'registry.json' },
      commit: { type: 'string', default: process.env.CITY_SKILL_COMMIT },
    },
  });
  try {
    const result = writeRegistry(values.root, values.output, { commit: values.commit ?? null });
    console.log(`Built ${result.destination} (${result.bytes} bytes): ${JSON.stringify(result.registry.stats)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}

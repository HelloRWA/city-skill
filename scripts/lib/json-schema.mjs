const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIsoDateTime(value) {
  return typeof value === 'string'
    && ISO_DATE_TIME.test(value)
    && Number.isFinite(Date.parse(value));
}

function matchesType(value, type) {
  switch (type) {
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    default: return true;
  }
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith('#/')) {
    throw new Error(`Only local JSON Schema references are supported: ${ref}`);
  }
  let current = rootSchema;
  for (const part of ref.slice(2).split('/')) {
    current = current[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return current;
}

/**
 * Validate the deliberately small JSON Schema 2020-12 subset used by this
 * repository. This is not advertised as a general-purpose schema validator.
 */
export function validateJsonSchema(value, schema, rootSchema = schema, path = '$') {
  if (schema.$ref) {
    return validateJsonSchema(value, resolveRef(rootSchema, schema.$ref), rootSchema, path);
  }

  const errors = [];
  const problem = (message) => errors.push({ path, message });

  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    problem(`must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    problem(`must be one of ${schema.enum.join(', ')}`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      problem(`must have type ${types.join(' or ')}`);
      return errors;
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) {
      problem(`must contain at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) {
      problem(`must contain at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern, 'u')).test(value)) {
      problem(`must match ${schema.pattern}`);
    }
    if (schema.format === 'date-time' && !isIsoDateTime(value)) {
      problem('must be a valid ISO 8601 date-time with Z or an explicit offset');
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      problem(`must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      problem(`must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problem(`must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      problem(`must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) problem('must contain unique items');
        seen.add(key);
      }
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchema(item, schema.items, rootSchema, `${path}[${index}]`));
      });
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) problem(`is missing required property ${key}`);
    }
    if (schema.properties) {
      for (const [key, child] of Object.entries(value)) {
        if (schema.properties[key]) {
          errors.push(...validateJsonSchema(child, schema.properties[key], rootSchema, `${path}.${key}`));
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) problem(`has unsupported property ${key}`);
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (!schema.properties?.[key]) {
          errors.push(...validateJsonSchema(child, schema.additionalProperties, rootSchema, `${path}.${key}`));
        }
      }
    }
  }

  return errors;
}

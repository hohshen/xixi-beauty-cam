// SPDX-License-Identifier: Apache-2.0
// Validate filter files (*.xixi-filter.json), beauty preset files (*.xixi-beauty.json) and
// style files (*.xixi-style.json) against their schema.json and the app's own validator.
//
//   node scripts/validate-presets.mjs                       # all built-ins (app/filters/, app/beauty/, app/styles/)
//   node scripts/validate-presets.mjs a.xixi-filter.json    # specific files, e.g. one you want to contribute
//
// The kind of each file is taken from its "format" field ("xixi-filter", "xixi-beauty" or "xixi-style").
// Built-in styles must point at a built-in filter and a built-in beauty preset; for a single style file
// the references are not checked (they may point at files the user imports alongside).
// Exits 1 if any file fails. Uses no dependencies: the schema keywords used by
// schema.json (type, const, required, properties, pattern, minLength, maxLength, minimum)
// are checked by the small validator below.
import { readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_KINDS as KINDS, kindOfFormat, validatePreset } from '../app/presets.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dirOf = (kind) => resolve(root, 'app', kind.dir);
const schemas = new Map(KINDS.map((k) => [k, JSON.parse(readFileSync(resolve(dirOf(k), 'schema.json'), 'utf8'))]));

function schemaCheck(s, v, path = '$') {
  const errs = [];
  if ('const' in s && v !== s.const) errs.push(`${path}: must be ${JSON.stringify(s.const)}`);
  if (s.type === 'object') {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return [`${path}: must be an object`];
    for (const k of s.required ?? []) if (!(k in v)) errs.push(`${path}.${k}: required`);
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in v) errs.push(...schemaCheck(sub, v[k], `${path}.${k}`));
  }
  if (s.type === 'string') {
    if (typeof v !== 'string') return [`${path}: must be a string`];
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errs.push(`${path}: must match ${s.pattern}`);
    if (s.minLength != null && [...v].length < s.minLength) errs.push(`${path}: shorter than ${s.minLength}`);
    if (s.maxLength != null && [...v].length > s.maxLength) errs.push(`${path}: longer than ${s.maxLength}`);
  }
  if (s.type === 'integer' && !Number.isInteger(v)) errs.push(`${path}: must be an integer`);
  if (s.type === 'number' && typeof v !== 'number') errs.push(`${path}: must be a number`);
  if (s.minimum != null && typeof v === 'number' && v < s.minimum) errs.push(`${path}: below ${s.minimum}`);
  return errs;
}

let failed = 0;
const report = (file, errs) => {
  if (errs.length === 0) {
    console.log(`ok   ${relative(process.cwd(), file) || file}`);
  } else {
    failed++;
    console.log(`FAIL ${relative(process.cwd(), file) || file}`);
    for (const e of errs) console.log(`     - ${e}`);
  }
};

function checkFile(path, { builtin = null } = {}) {
  const errs = [];
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    report(path, [`not valid JSON: ${e.message}`]);
    return null;
  }
  const kind = builtin ?? kindOfFormat(data?.format) ?? KINDS.find((k) => path.endsWith(k.ext));
  if (!kind) {
    report(path, [`unknown format ${JSON.stringify(data?.format)}; expected ${KINDS.map((k) => `"${k.format}"`).join(' or ')}`]);
    return null;
  }
  errs.push(...schemaCheck(schemas.get(kind), data));
  const r = validatePreset(kind, data);
  if (!r.ok) errs.push(...r.errors.map((e) => `validator: ${e.field} ${e.message ?? ''}`.trim()));
  if (!basename(path).endsWith(kind.ext)) errs.push(`file name must end with ${kind.ext} (format "${kind.format}")`);
  if (builtin) {
    if (r.ok && r.warnings.length) errs.push(...r.warnings.map((w) => `validator warning: ${w.field} ${w.message}`));
    if (basename(path) !== `${data.id}${kind.ext}`) errs.push(`file name must be ${data.id}${kind.ext}`);
    if (data.license !== 'CC0-1.0') errs.push('built-in presets must use license CC0-1.0');
  }
  report(path, errs);
  return data;
}

const args = process.argv.slice(2);
if (args.length > 0) {
  for (const f of args) checkFile(resolve(f));
} else {
  const builtinIds = new Map(); // kind -> Set(id)，給風格檢查引用用（KINDS 的順序是濾鏡、美顏、風格）
  for (const kind of KINDS) {
    const dir = dirOf(kind);
    const index = JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8'));
    const idxErrs = [];
    if (index.format !== kind.indexFormat) idxErrs.push(`format must be "${kind.indexFormat}"`);
    const ids = [];
    for (const name of index.presets ?? []) {
      if (!kind.fileRe.test(name)) {
        idxErrs.push(`bad entry ${name}`);
        continue;
      }
      const data = checkFile(resolve(dir, name), { builtin: kind });
      if (data) ids.push(data.id);
      if (data && kind.refs) {
        for (const [field, ref] of Object.entries(kind.refs)) {
          if (!builtinIds.get(ref)?.has(data[field])) idxErrs.push(`${name}: ${field} "${data[field]}" is not a built-in ${ref.format}`);
        }
      }
    }
    builtinIds.set(kind, new Set(ids));
    if (new Set(ids).size !== ids.length) idxErrs.push('duplicate preset id');
    // 濾鏡與美顏必須有 default；風格沒有預設選擇，有寫 default 才檢查
    if ((kind.defaultId !== null || 'default' in index) && !ids.includes(index.default))
      idxErrs.push(`default "${index.default}" is not in the list`);
    report(resolve(dir, 'index.json'), idxErrs);
  }
}

console.log(failed === 0 ? `\nAll preset files valid (${KINDS.map((k) => `"${k.format}"`).join(', ')}).` : `\n${failed} file(s) failed.`);
process.exit(failed === 0 ? 0 : 1);

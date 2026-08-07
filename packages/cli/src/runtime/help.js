import { usageError } from './errors.js';

export function canonicalCommandName(spec) {
  return spec.display_name || spec.command_path.join(' ');
}

export function formatDescribe(spec) {
  const lines = [
    `${canonicalCommandName(spec)}`,
    '',
    spec.summary,
    '',
    'When to use:',
    `  ${spec.when_to_use}`,
    '',
    `Mutates state: ${spec.mutates ? 'yes' : 'no'}`,
    `Idempotent: ${spec.idempotent ? 'yes' : 'no'}`,
    '',
    'Arguments and options:',
  ];

  const args = spec.args_schema?.arguments || [];
  const options = spec.args_schema?.options || [];
  if (!args.length && !options.length) {
    lines.push('  None');
  } else {
    for (const arg of args) {
      lines.push(`  ${arg.token}  ${arg.description}`);
    }
    for (const option of options) {
      lines.push(`  ${option.flags}  ${option.description}`);
    }
  }

  lines.push('', 'Examples:');
  for (const example of spec.examples || []) {
    lines.push(`  ${example}`);
  }

  lines.push('', 'Output shape:', `  ${spec.output_schema}`);
  lines.push('', 'Backend call:', `  ${JSON.stringify(spec.backend_call)}`);

  if (spec.related_commands?.length) {
    lines.push('', 'Related commands:');
    for (const related of spec.related_commands) {
      lines.push(`  ${related}`);
    }
  }

  return lines.join('\n');
}

export function findCommandSpec(specs, inputPath) {
  const normalized = inputPath.join(' ').trim().toLowerCase();
  const spec = specs.find((entry) => entry.command_path.join(' ').toLowerCase() === normalized);
  if (!spec) {
    throw usageError(`Unknown command path: ${inputPath.join(' ')}`);
  }
  return spec;
}

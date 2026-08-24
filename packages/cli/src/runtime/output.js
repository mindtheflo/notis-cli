import { inspect } from 'node:util';
import { EXIT_CODES } from './errors.js';

function pad(value, width) {
  return String(value).padEnd(width);
}

function formatTable(rows, columns) {
  if (!rows.length) {
    return '';
  }

  const widths = columns.map((column) => {
    const headerWidth = column.label.length;
    const valueWidth = Math.max(...rows.map((row) => String(column.value(row) ?? '').length), 0);
    return Math.max(headerWidth, valueWidth);
  });

  const header = columns.map((column, index) => pad(column.label, widths[index])).join('  ');
  const divider = columns.map((_, index) => '-'.repeat(widths[index])).join('  ');
  const body = rows.map((row) => columns.map((column, index) => pad(column.value(row) ?? '', widths[index])).join('  '));
  return [header, divider, ...body].join('\n');
}

function formatHint(hint) {
  if (typeof hint?.message === 'string' && hint.message) {
    return `  ${hint.message}`;
  }
  return `  ${hint?.command || ''}  ${hint?.reason || ''}`.trimEnd();
}

function yamlScalar(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function toYaml(value, indent = 0) {
  const prefix = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (!value.length) {
      return `${prefix}[]`;
    }
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const nested = toYaml(item, indent + 2);
          return `${prefix}-\n${nested}`;
        }
        return `${prefix}- ${yamlScalar(item)}`;
      })
      .join('\n');
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) {
      return `${prefix}{}`;
    }
    return entries
      .map(([key, nestedValue]) => {
        if (nestedValue && typeof nestedValue === 'object') {
          return `${prefix}${key}:\n${toYaml(nestedValue, indent + 2)}`;
        }
        return `${prefix}${key}: ${yamlScalar(nestedValue)}`;
      })
      .join('\n');
  }

  return `${prefix}${yamlScalar(value)}`;
}

function serializeMachineEnvelope(envelope, outputMode) {
  if (outputMode === 'yaml') {
    return `${toYaml(envelope)}\n`;
  }
  if (outputMode === 'ndjson') {
    return `${JSON.stringify(envelope)}\n`;
  }
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export class OutputManager {
  constructor(runtime) {
    this.runtime = runtime;
  }

  isMachineMode() {
    return this.runtime.outputMode !== 'table';
  }

  writeWarning(message) {
    if (this.isMachineMode()) {
      return;
    }
    process.stderr.write(`${message}\n`);
  }

  note(message) {
    if (this.isMachineMode()) {
      return;
    }
    process.stderr.write(`${message}\n`);
  }

  notice(message) {
    // Some pre-result instructions are required to make progress. They belong
    // on stderr so stdout stays one valid machine envelope, but unlike ordinary
    // table notes they must remain visible in JSON/YAML/NDJSON modes.
    process.stderr.write(`${message}\n`);
  }

  emitProgress({ phase, message, requestId = null }) {
    if (this.runtime.quiet) {
      return;
    }
    const suffix = requestId ? ` (${requestId})` : '';
    process.stderr.write(`[${phase}] ${message}${suffix}\n`);
  }

  emitSuccess({
    ok = true,
    command,
    data = {},
    humanSummary,
    hints = [],
    warnings = [],
    requestId = null,
    meta = {},
    renderHuman,
  }) {
    const envelope = {
      ok: Boolean(ok),
      command,
      data,
      human_summary: humanSummary,
      hints,
      warnings,
      request_id: requestId,
      meta: {
        profile: this.runtime.profileName,
        api_base: this.runtime.apiBase,
        mutating:
          meta.mutating === true
            ? true
            : (meta.mutating === false ? false : null),
        ...meta,
      },
    };

    if (this.isMachineMode()) {
      process.stdout.write(serializeMachineEnvelope(envelope, this.runtime.outputMode));
      return EXIT_CODES.ok;
    }

    for (const warning of warnings) {
      this.writeWarning(`Warning: ${warning}`);
    }

    if (typeof renderHuman === 'function') {
      const rendered = renderHuman();
      if (rendered) {
        process.stdout.write(`${rendered}\n`);
      }
    } else if (humanSummary) {
      process.stdout.write(`${humanSummary}\n`);
    } else if (Object.keys(data).length) {
      process.stdout.write(`${inspect(data, { depth: null, colors: this.runtime.color })}\n`);
    }

    if (hints.length) {
      const lines = hints.map(formatHint);
      process.stdout.write(`\nNext:\n${lines.join('\n')}\n`);
    }

    return EXIT_CODES.ok;
  }

  emitError({ command, error, requestId = null }) {
    const envelope = {
      ok: false,
      command,
      error: {
        code: error.code,
        message: error.message,
        retryable: Boolean(error.retryable),
        details: error.details || {},
      },
      hints: error.hints || [],
      warnings: error.warnings || [],
      request_id: requestId,
    };

    if (this.isMachineMode()) {
      process.stdout.write(serializeMachineEnvelope(envelope, this.runtime.outputMode));
      return error.exitCode || EXIT_CODES.unexpected;
    }

    process.stderr.write(`Error: ${error.message}\n`);
    for (const hint of error.hints || []) {
      process.stderr.write(`${formatHint(hint)}\n`);
    }
    return error.exitCode || EXIT_CODES.unexpected;
  }
}

export { formatTable };

#!/usr/bin/env node
import { createProgram } from './cli.js';

const program = createProgram();
await program.parseAsync(process.argv);

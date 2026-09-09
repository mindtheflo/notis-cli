#!/usr/bin/env node
import './check-runtime.js';

import('../src/cli.js').then(({ run }) => run());

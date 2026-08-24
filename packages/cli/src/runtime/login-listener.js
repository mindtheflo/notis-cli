#!/usr/bin/env node
// Entry point for the detached process that owns an OAuth loopback callback.
//
// Spawned by `notis login` / `notis start` whenever the calling process cannot
// wait for the browser itself — an agent reads a command's output only after it
// exits, so the command has to return the authorization URL while something
// else keeps listening. Never run this by hand: it takes a single argument, the
// path to a short-lived payload file the parent wrote and this process deletes.
import { runDetachedLoginListener } from './oauth.js';

process.exitCode = await runDetachedLoginListener(
  process.argv[2],
  undefined,
  process.argv[3],
);

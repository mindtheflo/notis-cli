// Channel selection for the CLI publish workflow, extracted from the inline
// github-script step so it is unit-testable (see test/release-channels.test.js).
//
// The frozen-`latest` incident (npm `latest` stuck at 0.2.2 for 7 weeks) was
// caused by this logic narrowing a scheduled `all` run to the workflow's ref
// branch -- and scheduled runs always execute on the default branch (beta), so
// the stable/production channel was never evaluated. Keeping the decision here,
// covered by tests, means a future edit can't silently re-freeze a channel.
//
// CommonJS (.cjs) on purpose: actions/github-script requires this file with
// require(), which must work regardless of the Node version on the runner.

const SUPPORTED_CHANNELS = ['beta', 'production'];

// Resolve the channels a run should evaluate.
//   inputChannel === 'all'  -> every supported channel (nightly + manual "all")
//   inputChannel === '<ch>' -> exactly that channel (explicit manual dispatch)
// Never key this on the ref branch: the scheduled run's ref is always the
// default branch, which is what froze the stable channel.
function resolveSelectedChannels(inputChannel, supportedChannels = SUPPORTED_CHANNELS) {
  const channel = inputChannel || 'all';
  const selected = channel === 'all' ? [...supportedChannels] : [channel];
  for (const value of selected) {
    if (!supportedChannels.includes(value)) {
      throw new Error(`Unsupported channel: ${value}`);
    }
  }
  return selected;
}

module.exports = { SUPPORTED_CHANNELS, resolveSelectedChannels };

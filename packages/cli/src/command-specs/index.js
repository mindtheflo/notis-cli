import { appsCommandSpecs } from './apps.js';
import { toolsCommandSpecs } from './tools.js';
import { metaCommandSpecs } from './meta.js';
import { onboardingCommandSpecs } from './onboarding.js';
import { diagnosticCommandSpecs } from './diagnostics.js';
import { smokeCommandSpecs } from './smoke.js';
import { authCommandSpecs } from './auth.js';
import { profileCommandSpecs } from './profile.js';

export const GROUP_SUMMARIES = {
  apps: 'Develop, deploy, and submit Notis Apps.',
  tools: 'Discover and execute generic tools exposed through Notis.',
  profile: 'Switch between signed-in accounts and their API endpoints.',
  debug: 'Inspect effective runtime context, worker identity, and trace costs.',
  smoke: 'Run deterministic connected-service smoke tests with guaranteed cleanup.',
};

export const COMMAND_SPECS = [
  ...authCommandSpecs,
  ...profileCommandSpecs,
  ...onboardingCommandSpecs,
  ...appsCommandSpecs,
  ...toolsCommandSpecs,
  ...diagnosticCommandSpecs,
  ...smokeCommandSpecs,
  ...metaCommandSpecs,
];

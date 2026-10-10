import { appsCommandSpecs } from './apps.js';
import { toolsCommandSpecs } from './tools.js';
import { metaCommandSpecs } from './meta.js';
import { onboardingCommandSpecs } from './onboarding.js';
import { diagnosticCommandSpecs } from './diagnostics.js';
import { smokeCommandSpecs } from './smoke.js';
import { authCommandSpecs } from './auth.js';
import { profileCommandSpecs } from './profile.js';
import { handoverCommandSpecs } from './handover.js';
import { agentsCommandSpecs } from './agents.js';
import { skillsCommandSpecs } from './skills.js';
import { spacesCommandSpecs } from './spaces.js';
import { viewsCommandSpecs } from './views.js';
import { filesCommandSpecs } from './files.js';

export const GROUP_SUMMARIES = {
  files: 'Upload local files for native records with verified byte receipts.',
  views: 'Discover and render the views you can open.',
  spaces: 'Build independent Spaces and their declared capabilities.',
  apps: 'Develop, deploy, and submit Notis Apps.',
  agents: 'Install Notis context into local coding agents.',
  handover: 'Hand the branch you are on to a Notis agent, hosted or your own Codex/Claude.',
  tools: 'Discover and execute generic tools exposed through Notis.',
  skills: 'List, edit and link Notis Skills, and keep local-agent skills synchronized.',
  profile: 'Switch between signed-in accounts and their API endpoints.',
  debug: 'Inspect effective runtime context, worker identity, and trace costs.',
  smoke: 'Run deterministic connected-service smoke tests with guaranteed cleanup.',
};

export const COMMAND_SPECS = [
  ...authCommandSpecs,
  ...profileCommandSpecs,
  ...onboardingCommandSpecs,
  ...agentsCommandSpecs,
  ...skillsCommandSpecs,
  ...spacesCommandSpecs,
  ...viewsCommandSpecs,
  ...filesCommandSpecs,
  ...appsCommandSpecs,
  ...handoverCommandSpecs,
  ...toolsCommandSpecs,
  ...diagnosticCommandSpecs,
  ...smokeCommandSpecs,
  ...metaCommandSpecs,
];

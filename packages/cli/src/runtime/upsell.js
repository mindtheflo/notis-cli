// One renderer for every upgrade_required refusal the CLI shows. The server
// builds the body (server/lib/tool_entitlements.py entitlement_upgrade_required_body,
// plus Cloud Computer overrides); this module only finds it in a payload and
// turns it into the lines and hints a person or agent acts on.

const UPSELL_CODES = new Set([
  'entitlement_upgrade_required',
  'cloud_computer_team_limit',
]);

const NESTED_KEYS = ['error', 'details', 'data', 'result', 'response', 'entitlement_access'];

const PORTAL_ORIGINS = {
  'api.notis.ai': 'https://app.notis.ai',
  'api-nightly.notis.ai': 'https://app-nightly.notis.ai',
  'api-beta.notis.ai': 'https://app-nightly.notis.ai',
};

function isUpsellBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.upgrade_required === true) return true;
  return typeof value.code === 'string' && UPSELL_CODES.has(value.code)
    && (typeof value.message === 'string' || value.next_action);
}

function parseJsonString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// Returns the upsell body inside a tool result, a COMPOSIO_MULTI_EXECUTE_TOOL
// envelope or a backend error payload, or null when there is none.
export function findUpsell(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return null;
  const parsed = parseJsonString(value);
  if (parsed) return findUpsell(parsed, depth + 1);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUpsell(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  if (isUpsellBody(value)) {
    // A backend error wraps the body as {code, message, details: {...body}}:
    // prefer the inner body, which carries next_action.
    const inner = value.details && typeof value.details === 'object' ? findUpsell(value.details, depth + 1) : null;
    return inner && inner.next_action && !value.next_action ? { ...value, ...inner } : value;
  }
  for (const key of NESTED_KEYS) {
    if (key in value) {
      const found = findUpsell(value[key], depth + 1);
      if (found) return found;
    }
  }
  if (Array.isArray(value.results)) return findUpsell(value.results, depth + 1);
  return null;
}

export function portalOriginFor(apiBase) {
  try {
    return PORTAL_ORIGINS[new URL(apiBase).hostname] || null;
  } catch {
    return null;
  }
}

function planLabel(plan) {
  if (typeof plan !== 'string' || !plan.trim()) return null;
  const value = plan.trim().replace(/[_-]+/g, ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPrice(price) {
  if (price === null || price === undefined || price === '') return null;
  if (typeof price === 'string' || typeof price === 'number') return String(price);
  if (typeof price !== 'object') return null;
  if (typeof price.label === 'string' && price.label) return price.label;
  const parts = [];
  if (price.monthly_usd !== undefined && price.monthly_usd !== null) parts.push(`$${price.monthly_usd} a month`);
  if (price.yearly_usd !== undefined && price.yearly_usd !== null) parts.push(`$${price.yearly_usd} a year`);
  if (price.hourly_usd !== undefined && price.hourly_usd !== null) parts.push(`$${price.hourly_usd} an hour`);
  return parts.length ? parts.join(', ') : null;
}

function formatUnlocks(unlocks) {
  if (typeof unlocks === 'string' && unlocks.trim()) return [unlocks.trim()];
  if (Array.isArray(unlocks)) return unlocks.filter((item) => typeof item === 'string' && item.trim());
  return [];
}

function upgradeLink(body, apiBase) {
  const url = typeof body.upgrade_url === 'string' && body.upgrade_url ? body.upgrade_url : '/subscribe';
  if (/^https?:\/\//.test(url)) return url;
  const origin = portalOriginFor(apiBase);
  return origin ? `${origin}${url.startsWith('/') ? '' : '/'}${url}` : null;
}

// Portal routes a next_action may name with `page` instead of a full url.
const ACTION_PAGES = {
  billing: { path: '/settings/billing', where: 'Settings, then Billing' },
};

const SUPPORT_URL = 'mailto:support@notis.ai';

function portalLink(path, apiBase) {
  const origin = portalOriginFor(apiBase);
  return origin ? `${origin}${path}` : null;
}

function toolCommand(tool, args = {}) {
  return `notis tools exec ${tool} --arguments '${JSON.stringify(args)}'`;
}

// Builds {message, lines, hints, upsell} for one upsell body. `lines` is the
// readable block for people; `hints` follow the CLI's {command, reason} shape
// so agents see the same next step in machine output.
export function renderUpsell(body, { apiBase } = {}) {
  const plan = planLabel(body.required_plan);
  const message = typeof body.message === 'string' && body.message
    ? body.message
    : (plan ? `Upgrade to ${plan} to use this.` : 'This needs a paid plan.');
  const lines = [message];
  const hints = [];

  const unlocks = formatUnlocks(body.unlocks);
  if (unlocks.length) {
    lines.push(plan ? `${plan} unlocks:` : 'The plan unlocks:');
    for (const item of unlocks) lines.push(`  - ${item}`);
  }
  const price = formatPrice(body.price);
  if (price) lines.push(`Price: ${price}`);

  const nextAction = body.next_action && typeof body.next_action === 'object' ? body.next_action : {};
  const link = upgradeLink(body, apiBase);
  const portalHint = {
    command: toolCommand('LOCAL_NOTIS_GET_PORTAL_URL', { page: 'subscribe' }),
    reason: 'Get the upgrade page link',
  };
  let actionUrl = null;

  switch (nextAction.action) {
    case 'contact_billing_owner': {
      const ask = typeof nextAction.message === 'string' && nextAction.message
        ? nextAction.message
        : 'Ask your team owner to upgrade.';
      lines.push(`Ask your team owner: ${ask}`);
      hints.push({ message: `Ask your team owner: ${ask}` });
      break;
    }
    case 'activate_paid_billing':
    case 'switch_trial_plan': {
      const tool = nextAction.tool || 'LOCAL_NOTIS_ACTIVATE_PAID_BILLING';
      const args = nextAction.action === 'switch_trial_plan' && nextAction.target_plan
        ? { target_plan: nextAction.target_plan }
        : {};
      const command = toolCommand(tool, args);
      lines.push(`Start my plan now: ${command}`);
      if (link) lines.push(`Or open the upgrade page: ${link}`);
      hints.push({ command, reason: 'Start my plan now' });
      if (!link) hints.push(portalHint);
      break;
    }
    case 'update_card': {
      const label = nextAction.label || 'Update card';
      const page = ACTION_PAGES[nextAction.page] || ACTION_PAGES.billing;
      actionUrl = /^https?:\/\//.test(nextAction.url || '') ? nextAction.url : portalLink(page.path, apiBase);
      if (actionUrl) {
        lines.push(`${label}: ${actionUrl}`);
        hints.push({ message: `${label}: ${actionUrl}` });
      } else {
        lines.push(`${label}: open ${page.where}, in the Notis app.`);
        hints.push({ command: toolCommand('LOCAL_NOTIS_GET_PORTAL_URL', { page: page.path }), reason: 'Get the billing page link' });
      }
      break;
    }
    case 'contact_us': {
      const label = nextAction.label || 'Contact us';
      actionUrl = typeof nextAction.url === 'string' && nextAction.url ? nextAction.url : SUPPORT_URL;
      lines.push(`${label}: ${actionUrl}`);
      hints.push({ message: `${label}: ${actionUrl}` });
      break;
    }
    case 'retry_entitlement_check':
      lines.push('Your plan could not be checked right now. Try again in a moment.');
      break;
    default: {
      if (link) {
        lines.push(`Open the upgrade page: ${link}`);
        hints.push({ message: `Open the upgrade page: ${link}` });
      } else {
        lines.push('Open the upgrade page in the Notis app.');
        hints.push(portalHint);
      }
    }
  }

  return {
    message,
    lines,
    text: lines.join('\n'),
    hints,
    upsell: {
      code: body.code || 'entitlement_upgrade_required',
      entitlement: body.entitlement || null,
      required_plan: body.required_plan || null,
      lock: body.lock || null,
      upgrade_url: link || body.upgrade_url || '/subscribe',
      next_action: nextAction.action || null,
      ...(actionUrl ? { action_url: actionUrl } : {}),
    },
  };
}

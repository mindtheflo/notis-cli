/**
 * What an agent that wrote a comment ran on, beside its name, like the chat timeline's runtime badge
 * (portal/src/components/manager/RuntimeBadge.tsx): the harness logo, small and grey, and on hover or keyboard focus a
 * card with the name, the logo, the intelligence bars and the speed glyph, "<Harness> / <Provider>" (Notis runs on
 * OpenAI or Claude, by its model) and one line each for intelligence, speed and model. Nothing without a recorded
 * runtime (`CommentAgent.runtime`).
 *
 * The logos are drawn inline in the text colour (the Space runtime has no Portal files: a Shadow DOM page, a Site).
 */

import React from 'react';
import { Tooltip } from '../overlay';
import type { CommentAgentRuntime, CommentRecord } from './commentModel';
import { agentDisplayName } from './commentModel';
import type { CommentWordKey } from './commentWords';
import type { CommentController } from './useComments';

/** Who runs an agent: Notis, or a coding engine named by its runtime provider. */
export type CommentHarness = 'notis' | 'codex' | 'claude_code' | 'kimi' | 'grok' | 'opencode_go' | 'muse' | 'cursor_agent'
  | 'kiro' | 'antigravity';
type ModelProvider = 'openai' | 'claude';
type Level = 'low' | 'medium' | 'high';
type Speed = 'flex' | 'normal' | 'priority';

/** The harness names the Portal shows (portal/src/lib/codingEngines.ts labels). */
export const COMMENT_HARNESS_NAMES: Readonly<Record<CommentHarness, string>> = {
  notis: 'Notis', codex: 'Codex', claude_code: 'Claude', kimi: 'Kimi', grok: 'Grok', opencode_go: 'OpenCode Go',
  muse: 'Muse Code', cursor_agent: 'Cursor', kiro: 'Kiro', antigravity: 'Antigravity',
};
const PROVIDER_NAME: Record<ModelProvider, string> = { openai: 'OpenAI', claude: 'Claude' };
/** A model provider's logo is its harness's: OpenAI is the Codex mark, Claude the Claude mark. */
const PROVIDER_HARNESS: Record<ModelProvider, CommentHarness> = { openai: 'codex', claude: 'claude_code' };

type LogoPath = string | readonly [d: string, evenOdd: true];
/**
 * Each harness mark, from portal/public/*-logo.svg, in one colour (the timeline greys them too). Kiro keeps its tile
 * with the ghost cut out. The Notis mark is the Notis tile (portal/public/icon-light.png) drawn as a path.
 */
const LOGOS: Readonly<Record<CommentHarness, { viewBox: string; paths: readonly LogoPath[] }>> = {
  notis: { viewBox: '0 0 24 24', paths: [['M1.4 1.3Q0.4 1.4 0.4 2.4V19.3L4.6 23.6 22 21.8Q22.9 21.7 22.9 20.8V5.3Q22.9 4.6 22.3 4.2L17.1 0.7Q16.6 0.4 16 0.4Z'
    + 'M2.4 2.6L15.4 1.8 19.4 3.7 4.9 4.6Z'
    + 'M6.6 13.5a6.9 7.2 0 1 0 13.8 0a6.9 7.2 0 1 0 -13.8 0Z'
    + 'M9.2 13.5a4.3 4.9 0 1 0 8.6 0a4.3 4.9 0 1 0 -8.6 0Z', true]] },
  codex: { viewBox: '0 0 24 24', paths: ['M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'] },
  claude_code: { viewBox: '0 0 24 24', paths: ['m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'] },
  kimi: { viewBox: '0 0 24 24', paths: ['M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441'] },
  grok: { viewBox: '56 56 400 400', paths: ['M210.484 312.759L343.465 210.383C349.984 205.364 359.302 207.322 362.408 215.117C378.758 256.231 371.454 305.64 338.925 339.563C306.397 373.487 261.137 380.927 219.768 363.983L174.577 385.803C239.394 432.008 318.104 420.581 367.289 369.251C406.303 328.564 418.386 273.104 407.088 223.091L407.19 223.198C390.807 149.726 411.218 120.359 453.03 60.3072C454.02 58.8833 455.01 57.4595 456 56L400.978 113.382V113.204L210.45 312.794Z', 'M183.042 337.641C136.519 291.294 144.54 219.567 184.236 178.203C213.59 147.59 261.683 135.096 303.666 153.464L348.755 131.75C340.632 125.627 330.221 119.042 318.275 114.414C264.277 91.2407 199.63 102.774 155.735 148.516C113.513 192.549 100.236 260.254 123.036 318.027C140.069 361.206 112.148 391.748 84.0229 422.575C74.0561 433.503 64.0553 444.431 56 456L183.007 337.677Z'] },
  opencode_go: { viewBox: '0 0 24 24', paths: ['M22 24H2V0h20zM17 4.8H7v14.4h10z'] },
  muse: { viewBox: '0 0 287.56 191', paths: ['m31.06,125.96c0,10.98 2.41,19.41 5.56,24.51 4.13,6.68 10.29,9.51 16.57,9.51 8.1,0 15.51-2.01 29.79-21.76 11.44-15.83 24.92-38.05 33.99-51.98l15.36-23.6c10.67-16.39 23.02-34.61 37.18-46.96 11.56-10.08 24.03-15.68 36.58-15.68 21.07,0 41.14,12.21 56.5,35.11 16.81,25.08 24.97,56.67 24.97,89.27 0,19.38-3.82,33.62-10.32,44.87-6.28,10.88-18.52,21.75-39.11,21.75l0-31.02c17.63,0 22.03-16.2 22.03-34.74 0-26.42-6.16-55.74-19.73-76.69-9.63-14.86-22.11-23.94-35.84-23.94-14.85,0-26.8,11.2-40.23,31.17-7.14,10.61-14.47,23.54-22.7,38.13l-9.06,16.05c-18.2,32.27-22.81,39.62-31.91,51.75-15.95,21.24-29.57,29.29-47.5,29.29-21.27,0-34.72-9.21-43.05-23.09-6.8-11.31-10.14-26.15-10.14-43.06z', 'm24.49,37.3c14.24-21.95 34.79-37.3 58.36-37.3 13.65,0 27.22,4.04 41.39,15.61 15.5,12.65 32.02,33.48 52.63,67.81l7.39,12.32c17.84,29.72 27.99,45.01 33.93,52.22 7.64,9.26 12.99,12.02 19.94,12.02 17.63,0 22.03-16.2 22.03-34.74l27.4-.86c0,19.38-3.82,33.62-10.32,44.87-6.28,10.88-18.52,21.75-39.11,21.75-12.8,0-24.14-2.78-36.68-14.61-9.64-9.08-20.91-25.21-29.58-39.71l-25.79-43.08c-12.94-21.62-24.81-37.74-31.68-45.04-7.39-7.85-16.89-17.33-32.05-17.33-12.27,0-22.69,8.61-31.41,21.78z', 'm82.35,31.23c-12.27,0-22.69,8.61-31.41,21.78-12.33,18.61-19.88,46.33-19.88,72.95 0,10.98 2.41,19.41 5.56,24.51l-26.48,17.44c-6.8-11.31-10.14-26.15-10.14-43.06 0-30.75 8.44-62.8 24.49-87.55 14.24-21.95 34.79-37.3 58.36-37.3z'] },
  cursor_agent: { viewBox: '0 0 24 24', paths: ['M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23'] },
  kiro: { viewBox: '0 0 1200 1200', paths: [['M260 0H940A260 260 0 0 1 1200 260V940A260 260 0 0 1 940 1200H260A260 260 0 0 1 0 940V260A260 260 0 0 1 260 0ZM398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554ZM636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123ZM771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z', true]] },
  antigravity: { viewBox: '11 11 90 90', paths: ['M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z'] },
};

function isHarness(value: string | null | undefined): value is CommentHarness {
  return value != null && Object.prototype.hasOwnProperty.call(COMMENT_HARNESS_NAMES, value);
}
const isLevel = (value: string | null | undefined): value is Level => value === 'low' || value === 'medium' || value === 'high';

/** Notis runs on OpenAI or Claude; the recorded model says which (the timeline's modelProviderOf). */
export function commentModelProvider(model: string | null | undefined): ModelProvider | undefined {
  if (!model) return undefined;
  return /claude|anthropic|opus|sonnet|haiku|fable/i.test(model) ? 'claude' : 'openai';
}

/** Anthropic's standard tier is "default"; it is the Standard speed. */
function speedOf(speed: string | null | undefined): Speed | undefined {
  if (speed === 'default' || speed === 'standard') return 'normal';
  return speed === 'flex' || speed === 'normal' || speed === 'priority' ? speed : undefined;
}

const LEVEL_WORD: Record<Level, CommentWordKey> = { low: 'runtimeModeLow', medium: 'runtimeModeMedium', high: 'runtimeModeHigh' };
const SPEED_WORD: Record<Speed, CommentWordKey> = { priority: 'runtimeSpeedPriority', normal: 'runtimeSpeedNormal', flex: 'runtimeSpeedFlex' };

export interface CommentAgentRuntimeView {
  harness?: CommentHarness; modelProvider?: ModelProvider; level?: Level; speed?: Speed;
  /** "Codex", "Claude": the harness, when it is not the agent's own name. */
  runHarness?: string;
  /** "OpenAI" or "Claude" for Notis. */
  runProvider?: string;
  /** "Notis / OpenAI": who runs it, each part once. */
  runtimeName: string;
  /** One line each for intelligence, speed and model. */
  details: string[];
  /** Everything in words, for the logo's accessible name: "Fred · Codex · Intelligence: High · Speed: Fast". */
  label: string;
}

/** What the badge and its card say, worked out the way the chat timeline does (RuntimeBadge useRuntimeBadge). */
export function commentAgentRuntimeView(say: CommentController['say'], name: string, runtime: CommentAgentRuntime): CommentAgentRuntimeView {
  const harness = isHarness(runtime.provider) ? runtime.provider : undefined;
  const modelProvider = harness === 'notis' ? commentModelProvider(runtime.model) : undefined;
  const mode = runtime.intelligence ?? undefined;
  const effort = runtime.effort ?? undefined;
  const speed = speedOf(runtime.speed);
  const level = isLevel(mode) ? mode : isLevel(effort) ? effort : undefined;
  const harnessName = runtime.label || (harness ? COMMENT_HARNESS_NAMES[harness] : undefined);
  const providerName = modelProvider ? PROVIDER_NAME[modelProvider] : undefined;
  // Each part once, never repeating the agent's own name.
  const runHarness = harnessName && harnessName !== name && harnessName !== providerName ? harnessName : undefined;
  const runProvider = providerName && providerName !== name ? providerName : undefined;
  const runtimeName = [runHarness, runProvider].filter(Boolean).join(' / ');
  const details = [
    isLevel(mode) ? say('runtimeIntelligence', { mode: say(LEVEL_WORD[mode]) })
      : effort ? say('runtimeEffort', { effort }) : mode ? say('runtimeIntelligence', { mode }) : say('runtimeIntelligenceUnavailable'),
    speed ? say('runtimeSpeed', { speed: say(SPEED_WORD[speed]) }) : say('runtimeSpeedUnavailable'),
    runtime.model ? say('runtimeModel', { model: runtime.model }) : '',
  ].filter(Boolean);
  const label = [name, runtimeName, ...details].filter(Boolean).join(' · ');
  return { harness, modelProvider, level, speed, runHarness, runProvider, runtimeName, details, label };
}

/** A harness mark in the text colour. Decorative: the badge carries the name. */
export function CommentHarnessLogo({ harness, className = 'nui-runtime-logo' }: { harness: CommentHarness; className?: string }) {
  const logo = LOGOS[harness];
  return (
    <svg className={className} viewBox={logo.viewBox} fill="currentColor" aria-hidden="true" focusable="false" data-harness={harness}>
      {logo.paths.map((path, index) => typeof path === 'string'
        ? <path key={index} d={path} />
        : <path key={index} d={path[0]} fillRule="evenodd" clipRule="evenodd" />)}
    </svg>
  );
}

// The timeline's glyphs (portal runtimeOverrideIcons.tsx and its Phosphor icons), drawn inline.
const BAR_HEIGHTS = [3, 5, 7, 9, 11];
const ACTIVE_BARS: Record<Level, number> = { low: 1, medium: 3, high: 5 };
const BAR_START = (16 - (5 * 2 + 4 * 1.25)) / 2;

/** Five rising bars, lit up to the level. */
function IntelligenceGlyph({ level }: { level?: Level }) {
  if (!level) {
    // No level recorded: the brain, as the timeline shows it.
    return (
      <svg className="nui-runtime-glyph" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false" data-glyph="brain">
        <path d="M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z" />
      </svg>
    );
  }
  return (
    <svg className="nui-runtime-glyph" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false" data-glyph="bars" data-level={level}>
      {BAR_HEIGHTS.map((height, index) => (
        <rect key={index} x={BAR_START + index * 3.25} y={14 - height} width={2} height={height} rx={0.75} fill="currentColor"
          opacity={index < ACTIVE_BARS[level] ? 1 : 0.25} />
      ))}
    </svg>
  );
}

const LIGHTNING_OUTLINE = 'M215.79,118.17a8,8,0,0,0-5-5.66L153.18,90.9l14.66-73.33a8,8,0,0,0-13.69-7l-112,120a8,8,0,0,0,3,13l57.63,21.61L88.16,238.43a8,8,0,0,0,13.69,7l112-120A8,8,0,0,0,215.79,118.17ZM109.37,214l10.47-52.38a8,8,0,0,0-5-9.06L62,132.71l84.62-90.66L136.16,94.43a8,8,0,0,0,5,9.06l52.8,19.8Z';
const LIGHTNING_FILL = 'M213.85,125.46l-112,120a8,8,0,0,1-13.69-7l14.66-73.33L45.19,143.49a8,8,0,0,1-3-13l112-120a8,8,0,0,1,13.69,7L153.18,90.9l57.63,21.61a8,8,0,0,1,3,12.95Z';
const FEATHER = 'M221.28,34.75a64,64,0,0,0-90.49,0L60.69,104A15.9,15.9,0,0,0,56,115.31v73.38L26.34,218.34a8,8,0,0,0,11.32,11.32L67.32,200H140.7A15.92,15.92,0,0,0,152,195.32l0,0,69.23-70A64,64,0,0,0,221.28,34.75ZM142.07,46.06A48,48,0,0,1,211.79,112H155.33l34.35-34.34a8,8,0,0,0-11.32-11.32L120,124.69V67.87ZM72,115.35l32-31.67v57l-32,32ZM140.7,184H83.32l56-56h56.74Z';

/** Feather for Economy, an outline lightning for Standard, a filled one for Fast; a faint lightning when unknown. */
function SpeedGlyph({ speed }: { speed?: Speed }) {
  const d = speed === 'flex' ? FEATHER : speed === 'priority' ? LIGHTNING_FILL : LIGHTNING_OUTLINE;
  return (
    <svg className="nui-runtime-glyph" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"
      data-glyph="speed" data-speed={speed ?? 'unknown'}>
      <path d={d} />
    </svg>
  );
}

function RuntimeGlyphs({ view }: { view: CommentAgentRuntimeView }) {
  return (
    <span className="nui-runtime-glyphs">
      {view.harness ? <CommentHarnessLogo harness={view.harness} /> : null}
      <IntelligenceGlyph level={view.level} />
      <SpeedGlyph speed={view.speed} />
    </span>
  );
}

/** The hover card: who wrote, then who runs it, then one line per intelligence, speed and model. */
export function CommentAgentRuntimeCard({ name, view }: { name: string; view: CommentAgentRuntimeView }) {
  return (
    <span className="nui-runtime-card">
      <span className="nui-runtime-card-head">
        <span className="nui-runtime-card-name">{name}</span>
        <RuntimeGlyphs view={view} />
      </span>
      {view.runtimeName ? (
        <span className="nui-runtime-card-line" data-runtime-provider={view.modelProvider}>
          {view.runHarness}{view.runHarness && view.runProvider ? ' / ' : null}
          {view.modelProvider && view.runProvider ? <CommentHarnessLogo harness={PROVIDER_HARNESS[view.modelProvider]} /> : null}
          {view.runProvider}
        </span>
      ) : null}
      {view.details.map(detail => <span key={detail} className="nui-runtime-card-line">{detail}</span>)}
    </span>
  );
}

/**
 * After an agent's name on its comment: the harness logo, with the runtime card on hover and on keyboard focus (Tab
 * reaches it; its accessible name says everything the card shows). Nothing on a person's comment or an agent with no
 * recorded runtime.
 */
export function CommentAgentBadge({ controller, comment }: { controller: CommentController; comment: CommentRecord }) {
  const runtime = comment.agent?.runtime;
  if (!runtime) return null;
  const name = agentDisplayName(comment.author || comment.agent!.name);
  const view = commentAgentRuntimeView(controller.say, name, runtime);
  return (
    <Tooltip label={view.label} side="bottom" align="start" card={<CommentAgentRuntimeCard name={name} view={view} />}>
      <span className="nui-runtime-badge" role="img" tabIndex={0} aria-label={view.label} data-part="agent-runtime"
        data-harness={view.harness}>
        {view.harness ? <CommentHarnessLogo harness={view.harness} /> : <IntelligenceGlyph />}
      </span>
    </Tooltip>
  );
}

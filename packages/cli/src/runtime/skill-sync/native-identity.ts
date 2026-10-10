import type { CloudSkill, NativeSkillReference, SyncedSkill, SyncPullResponse } from './types';
import { createHash } from 'node:crypto';

export const NATIVE_IDENTITY_FILE = '.notis-native-skill.json';
export interface NativeSkillIdentity {
  schema: 1;
  cloudId: string;
  reference: NativeSkillReference;
  displayName: string;
  frontmatterName: string;
  scope: string;
  folderHash: string;
  files: Record<string, string>;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function checkedNativeReference(value: unknown, cloudId?: string): NativeSkillReference {
  const reference = value as NativeSkillReference;
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)
      || Object.keys(reference).sort().join(',') !== 'access_revision,kind,skill_id,version'
      || reference.kind !== 'native_standalone_skill' || !UUID.test(reference.skill_id)
      || (cloudId !== undefined && reference.skill_id !== cloudId)
      || !Number.isSafeInteger(reference.access_revision) || reference.access_revision < 0
      || !reference.version || Object.keys(reference.version).sort().join(',') !== 'digest,revision'
      || !Number.isSafeInteger(reference.version.revision) || reference.version.revision < 1
      || !/^[a-f0-9]{64}$/.test(reference.version.digest)) {
    throw new Error('Native Skill identity is unavailable. Refresh before syncing.');
  }
  return structuredClone(reference);
}

export function nativeDirectory(reference: NativeSkillReference): string {
  return 'native-' + checkedNativeReference(reference).skill_id;
}

export function sameNativeReference(left?: NativeSkillReference, right?: NativeSkillReference): boolean {
  return Boolean(left && right && left.skill_id === right.skill_id
    && left.access_revision === right.access_revision && left.version.revision === right.version.revision
    && left.version.digest === right.version.digest);
}

export function isNativeSkill(skill: CloudSkill): boolean {
  return skill.source === 'native' || skill.native_reference !== undefined;
}

export function assertNativePull(response: SyncPullResponse): void {
  const ids = new Set<string>();
  for (const skill of response.skills) {
    if (!isNativeSkill(skill)) continue;
    const reference = checkedNativeReference(skill.native_reference, skill.id);
    if (response.skill_sync_protocol !== 2 || skill.name !== nativeDirectory(reference) || ids.has(skill.id)
        || !/^[a-f0-9]{64}$/.test(response.sync_scope || '') || skill.native_scope !== response.sync_scope
        || !Array.isArray(skill.bundle_files) || skill.bundle_hydration_failed || typeof skill.skill_md !== 'string') {
      throw new Error('Native Skill inventory is incomplete. Existing local files were retained.');
    }
    const paths = new Set<string>();
    let entrypoint = false;
    for (const file of skill.bundle_files) {
      if (typeof file.path !== 'string' || typeof file.content_b64 !== 'string'
          || file.path.startsWith('/') || file.path.includes('\\') || file.path.includes('\0')
          || file.path.split('/').some(part => !part || part === '.' || part === '..')
          || paths.has(file.path.toLowerCase()) || file.path.toLowerCase() === NATIVE_IDENTITY_FILE) {
        throw new Error('Native Skill bundle has a conflicting managed path.');
      }
      paths.add(file.path.toLowerCase());
      if (file.path === 'SKILL.md') {
        entrypoint = Buffer.from(file.content_b64, 'base64').equals(Buffer.from(skill.skill_md, 'utf8'));
      }
    }
    if (!entrypoint) throw new Error('Native Skill instructions and files do not match.');
    ids.add(skill.id);
  }
}

export function nativeFileDigest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function nativeFrontmatterName(markdown: string): string {
  const header = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  return header?.[1].match(/^name\s*:\s*(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '') || '';
}

export function checkedNativeIdentity(value: unknown): NativeSkillIdentity {
  const identity = value as NativeSkillIdentity;
  if (!identity || identity.schema !== 1 || typeof identity.cloudId !== 'string'
      || typeof identity.displayName !== 'string' || typeof identity.frontmatterName !== 'string'
      || !/^[a-f0-9]{64}$/.test(identity.scope) || !/^[a-f0-9]{64}$/.test(identity.folderHash)
      || !identity.files || !Object.keys(identity.files).includes('SKILL.md')
      || Object.entries(identity.files).some(([name, hash]) => name.startsWith('/') || name.includes('\\')
        || name.split('/').some(part => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error('Native Skill provenance is incomplete. Existing files were retained.');
  }
  return { ...identity, reference: checkedNativeReference(identity.reference, identity.cloudId) };
}

export function nativeState(skill: CloudSkill): Partial<SyncedSkill> {
  if (!isNativeSkill(skill)) return {};
  return { nativeReference: checkedNativeReference(skill.native_reference, skill.id),
    ...(skill.native_settings ? { nativeSettingsRevision: skill.native_settings.revision } : {}),
    nativeDisplayName: skill.display_name || skill.name, nativeScope: skill.native_scope, nativeUnavailable: false };
}

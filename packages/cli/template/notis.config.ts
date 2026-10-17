import { defineSpaces } from '@notis/sdk/config';

// The workspace Space index. `notis spaces init` replaces it with the Spaces it
// scaffolds; each entry points at a definition file that exports defineSpace().
export default defineSpaces({ spaces: {} });

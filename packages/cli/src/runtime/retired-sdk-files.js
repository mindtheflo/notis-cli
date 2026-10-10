/** Exact canonical files retired by the one-Shadow-runtime cutover.
 * Modified or additional source is retained for explicit reconciliation. */
// Host mounting code stays in the canonical SDK and CLI host bundle, not in
// authored apps' public SDK mirror. It is not a public package export.
export const HOST_ONLY_SDK_FILES = Object.freeze(['src/presentation.tsx']);

export const RETIRED_SDK_FILES = Object.freeze({
  "src/presentation.tsx": [
    "d29022f92e1e96b451b62cc8a561878a1c0cf8a3b4c0419181de7266f8a1b525"
  ],
  "src/isolatedHost.tsx": [
    "7f59049281a9533d39c557ca75635073c2f404f1eb0a528b274323d61db776cd"
  ],
  "src/frameProtocol.ts": [
    "f32337ddb507718be04289a4acf50cf2485698bc716556230f35f06a6f633f19"
  ],
  "src/frameIsolation.ts": [
    "8b57cb38f618eefc4133ae50fbf2b37bbdef5be02e44b39758d8328fb2a59ab6"
  ]
});

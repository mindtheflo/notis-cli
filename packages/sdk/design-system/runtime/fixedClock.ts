/**
 * The fixed clock of a book frame (`frame/determinism.ts`, 2026-06-15T09:30:00Z), for the render smoke test, which
 * renders states outside a frame. Import it before the toolkit and the specimens, as a frame does, so module level
 * dates are fixed too.
 */
import { installClock } from '../frame/determinism';
import { FIXED_NOW } from '../specimen';

installClock(FIXED_NOW);

/**
 * Playable-ad entry.
 *
 * The creative runs the REAL game — importing `../main` boots it exactly as
 * `index.html` does. Everything this module adds lives outside the game: the
 * store CTA, the end card, and the `ALPlayableAnalytics` reporting the
 * marketing-readiness spec requires.
 *
 * Nothing here may reach into game state to CHANGE it. The shell only reads the
 * debug handle the game already exposes on `window.__game`, so the ad and the
 * shipped game cannot drift apart.
 */
import '../main';
import { installShell } from './shell';

installShell();

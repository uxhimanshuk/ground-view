import { SCENE_APPEND_RECIPES } from '../recipes.js';
import { DAY_ON_EARTH_RECIPE } from '../dayOnEarth.js';
import { createScenePackRegistry } from './registry.js';
import { nepalScenePresentation } from './nepal.js';

/** Compose the installed scene recipes and their trusted presentation rules. */
export function createDefaultScenePacks() {
  return createScenePackRegistry({
    recipes: [...SCENE_APPEND_RECIPES, DAY_ON_EARTH_RECIPE],
    adapters: [nepalScenePresentation],
  });
}

import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createWorldBankIndicatorSource } from '../layers/indicators/source.js';
import { createBundledValuesSource } from '../layers/values/bundledSource.js';
import { createBundledLanguageSource } from '../layers/languages/bundledSource.js';
import { createNewsToneSource } from '../layers/newsTone/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';

/** Construct the existing reference feeds independently of application setup. */
export function createReferenceSources() {
  return {
    earthquakes: createUsgsEarthquakeSource(),
    'fire-perimeters': createWfigsPerimeterSource(),
    cables: createBundledCableSource(),
    indicators: createWorldBankIndicatorSource(),
    values: createBundledValuesSource(),
    languages: createBundledLanguageSource(),
    'news-tone': createNewsToneSource(),
  };
}

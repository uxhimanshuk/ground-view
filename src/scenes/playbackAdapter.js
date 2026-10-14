/** Connect the portable Director runner to the existing scene presentation. */
export function createScenePlaybackAdapter(director, defaultShotDurationSec) {
  let timing;
  let travel;
  // The shot as played this run: a copy when a live beat chose its camera.
  let live = null;
  return {
    async releaseScene(scene, token) {
      const released = await director._releaseSceneLayers(scene, token);
      if (!token || released) director._loadedSceneId = null;
      return released;
    },
    selectShot({ scene, shot, index, total }) {
      director._selectedSceneId = scene.id;
      director._selectedShotId = shot.id;
      director._renderSceneSelect();
      director._renderShotList();
      director._updateStatus(
        `Running ${index + 1}/${total}: ${scene.title} / ${shot.title}`,
      );
      director._logEvent('shot_start', {
        sceneId: scene.id,
        shotId: shot.id,
        title: shot.title,
        index,
      });
    },
    applyVisual({ shot, token }) {
      return director.styleManager.applyVisualState(
        director._visualStateForShot(shot),
        { isCurrent: () => !token.cancelled && !token.signal?.aborted },
      );
    },
    async applyLayers({ scene, shot, token }) {
      director._setSceneMediaPlayback(scene, shot, token);
      const result = await director._applyLayerStates(
        director._layerStatesForShot(scene, shot),
        token,
      );
      if (
        !token.cancelled &&
        !result.refused.length &&
        !(await director._applyDataPacks(scene, shot, token))
      )
        throw new Error('Data packs unavailable');
      return result;
    },
    async travel({ scene, shot, token }) {
      live = (await director._beats?.prepare(scene, shot, token)) || shot;
      if (token.cancelled) return;
      director._loadedSceneId = scene.id;
      const duration = live.durationSec || defaultShotDurationSec;
      timing = director._startSceneClockTicker(scene, live, token);
      travel = director._beginShotTravel(scene, live, duration);
      const flight = director._flyShotCamera(scene, live, duration, token);
      director._publishShotTravel(scene, live, travel);
      return flight;
    },
    settle({ scene, shot, token }) {
      director._settleShotLayerStates(scene, shot, token, travel);
    },
    hold({ scene, shot, token }) {
      return director._holdShot(scene, live || shot, token);
    },
    completeShot({ scene, shot, index }) {
      live = null;
      director._clock.stopSceneTimer();
      director._publishSceneClock(scene, shot, timing.endElapsedSec, {
        running: true,
      });
      director._logEvent('shot_end', {
        sceneId: scene.id,
        shotId: shot.id,
        index,
      });
    },
    complete() {
      director._beats?.clear();
      director._setProgress(1);
      director._updateStatus('Scene run complete');
      director._logEvent('scene_run_complete', {});
    },
  };
}

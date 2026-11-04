// Source helpers: each returns a Web Audio node plus a stop() function.
// Kept separate from the engine so each browser API's quirks live in one place.

export class SourceError extends Error {}

export interface ActiveSource {
  node: AudioNode;
  /** Whether this source should be heard through the speakers. */
  audible: boolean;
  stop(): void;
  /** Present only for file playback. */
  media?: HTMLAudioElement;
  /** Fires when the source ends on its own (user stops sharing, file ends). */
  onEnded?: (cb: () => void) => void;
  /** Live audio-track settings (capture and mic), to confirm voice filters are off. */
  settings?: () => MediaTrackSettings | null;
}

/** File: streamed through an <audio> element, never decoded whole into memory. */
export function fileSource(ctx: AudioContext, file: File): ActiveSource {
  const audio = new Audio();
  const url = URL.createObjectURL(file);
  audio.src = url;
  audio.preload = 'auto';
  const node = ctx.createMediaElementSource(audio);
  return {
    node,
    audible: true,
    media: audio,
    stop() {
      audio.pause();
      node.disconnect();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
    },
    onEnded(cb) {
      audio.addEventListener('ended', cb);
    },
  };
}

function streamSource(ctx: AudioContext, stream: MediaStream): ActiveSource {
  const node = ctx.createMediaStreamSource(stream);
  const tracks = stream.getTracks();
  return {
    node,
    // Captured and mic audio is analysed only, never played back (no echo or feedback).
    audible: false,
    stop() {
      node.disconnect();
      for (const t of tracks) t.stop();
    },
    onEnded(cb) {
      // Any track ending (incl. the screen-share video) means the share stopped.
      for (const t of tracks) t.addEventListener('ended', cb);
    },
    settings() {
      return stream.getAudioTracks()[0]?.getSettings() ?? null;
    },
  };
}

/** Plain-English fix for a share that carried no audio (displaySurface from Chrome). */
export function noAudioMessage(surface: string | undefined): string {
  if (surface === 'window') {
    return "You shared a single window, and windows cannot carry sound. Click Tab / system audio again and choose a Chrome Tab (with 'Share tab audio' ticked) or Entire Screen (with 'Share system audio' ticked).";
  }
  if (surface === 'monitor') {
    return "You shared the whole screen without system sound. Click Tab / system audio again and tick 'Share system audio' in the prompt.";
  }
  return "No audio was shared. Click Tab / system audio again and tick 'Share tab audio' (for a Chrome tab) or 'Share system audio' (for the whole screen) in the share prompt.";
}

/** Tab or system audio through the screen-share prompt (Chrome/Edge desktop). */
export async function displaySource(ctx: AudioContext): Promise<ActiveSource> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new SourceError('This browser cannot share tab or system audio. Use Chrome or Edge on desktop.');
  }
  // Chrome requires video in the request. Stopping the video track can end the
  // whole share in some Chrome builds (Council round 2), so we keep it but ask
  // for the smallest, slowest video possible and never draw it.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { max: 1 }, width: { max: 320 }, height: { max: 240 } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // Chrome hints: offer system audio and keep the current tab out of the list.
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
  } as DisplayMediaStreamOptions);
  if (stream.getAudioTracks().length === 0) {
    // Read what was actually shared, so the message can say exactly what to change.
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
    for (const t of stream.getTracks()) t.stop(); // don't leave an orphaned share running
    throw new SourceError(noAudioMessage(surface));
  }
  return streamSource(ctx, stream);
}

/** Microphone with all speech processing off, so music isn't filtered. */
export async function micSource(ctx: AudioContext): Promise<ActiveSource> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new SourceError('This browser cannot use the microphone.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  return streamSource(ctx, stream);
}

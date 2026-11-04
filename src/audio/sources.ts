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
      for (const t of stream.getAudioTracks()) t.addEventListener('ended', cb);
    },
  };
}

/** Tab or system audio through the screen-share prompt (Chrome/Edge desktop). */
export async function displaySource(ctx: AudioContext): Promise<ActiveSource> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new SourceError('This browser cannot share tab or system audio. Use Chrome or Edge on desktop.');
  }
  // Chrome requires video in the request; we drop the video track right away.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // Chrome hints: offer system audio and keep the current tab out of the list.
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
  } as DisplayMediaStreamOptions);
  for (const v of stream.getVideoTracks()) {
    v.stop();
    stream.removeTrack(v);
  }
  if (stream.getAudioTracks().length === 0) {
    throw new SourceError("No audio was shared. Try again and tick 'Share audio' (or 'Share system audio') in the share prompt.");
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

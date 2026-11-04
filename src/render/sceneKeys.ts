// Key-to-scene mapping (Stage 2, P5). Pure, so the keydown handler stays a one-liner.
//   0 = crown: flight tunnel + radial crown + particles + shockwave (the default)
//   1 = flight: tunnel + particles + shockwave, no crown
//   2 = bars: the standalone 2D bars and rings scene
export type SceneName = 'crown' | 'flight' | 'bars';

/** The scene for a key value, or null for keys that do nothing. */
export function sceneForKey(key: string): SceneName | null {
  switch (key) {
    case '0':
      return 'crown';
    case '1':
      return 'flight';
    case '2':
      return 'bars';
    default:
      return null;
  }
}

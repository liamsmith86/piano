// Keep the lazy Tone chunk tree-shakeable. Importing the complete namespace
// dynamically would otherwise retain exports this application never uses.
export {
  Sampler,
  Synth,
  ToneAudioBuffer,
  getContext,
  getDraw,
  getTransport,
  now,
  setContext,
  start,
} from 'tone';

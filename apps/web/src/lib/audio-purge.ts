// purgeAudio/AudioDeleter live in @ktb/server-fns (P-033) so plugin-owned
// server functions share the helper; this module stays as the host's
// import path.
export { purgeAudio } from "@ktb/server-fns";

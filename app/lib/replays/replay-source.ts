// The only replay lane this site surfaces. boss_playbook_replays also holds
// uploads (NULL source) and Discord forum rows, and RLS does not separate them,
// so every read of that table must filter on this constant.
export const TERMINUS_SOURCE_SYSTEM = 'terminus-maximus'

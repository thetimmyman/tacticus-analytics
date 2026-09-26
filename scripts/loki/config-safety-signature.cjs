'use strict'
// The single "safe contents-roll" guard for LOKI GlobalConfig: safe only when the season anchors are
// untouched. Every consumer must use this module; dependency-free on purpose.

/** Canonical string of the fields that make a change unsafe to auto-adopt. */
function safetySignature(cfg) {
  const gb = (cfg && cfg.guildBoss) || {}
  const misc = gb.misc || {}
  return JSON.stringify({
    rotation: gb.guildBossSeasonConfigRotation ?? [],
    firstSeasonStart: misc.firstSeasonStart ?? null,
    seasonDuration: misc.seasonDuration ?? null,
    bufferAfterSeasonEnd: misc.bufferAfterSeasonEnd ?? null
  })
}

function isSafeContentsRoll(oldCfg, newCfg) {
  return safetySignature(oldCfg) === safetySignature(newCfg)
}

module.exports = { safetySignature, isSafeContentsRoll }

import { TFunction } from 'i18next'

/** The name of each BW upgrade id, indexed by upgrade id. Ids the game doesn't use are left out. */
const UPGRADES: ReadonlyArray<((t: TFunction) => string) | undefined> = [
  t => t('game.upgrade.terranInfantryArmor', 'Terran Infantry Armor'), // 0
  t => t('game.upgrade.terranVehiclePlating', 'Terran Vehicle Plating'), // 1
  t => t('game.upgrade.terranShipPlating', 'Terran Ship Plating'), // 2
  t => t('game.upgrade.zergCarapace', 'Zerg Carapace'), // 3
  t => t('game.upgrade.zergFlyerCarapace', 'Zerg Flyer Carapace'), // 4
  t => t('game.upgrade.protossGroundArmor', 'Protoss Ground Armor'), // 5
  t => t('game.upgrade.protossAirArmor', 'Protoss Air Armor'), // 6
  t => t('game.upgrade.terranInfantryWeapons', 'Terran Infantry Weapons'), // 7
  t => t('game.upgrade.terranVehicleWeapons', 'Terran Vehicle Weapons'), // 8
  t => t('game.upgrade.terranShipWeapons', 'Terran Ship Weapons'), // 9
  t => t('game.upgrade.zergMeleeAttacks', 'Zerg Melee Attacks'), // 10
  t => t('game.upgrade.zergMissileAttacks', 'Zerg Missile Attacks'), // 11
  t => t('game.upgrade.zergFlyerAttacks', 'Zerg Flyer Attacks'), // 12
  t => t('game.upgrade.protossGroundWeapons', 'Protoss Ground Weapons'), // 13
  t => t('game.upgrade.protossAirWeapons', 'Protoss Air Weapons'), // 14
  t => t('game.upgrade.protossPlasmaShields', 'Protoss Plasma Shields'), // 15
  t => t('game.upgrade.u238Shells', 'U-238 Shells'), // 16
  t => t('game.upgrade.ionThrusters', 'Ion Thrusters'), // 17
  t => t('game.upgrade.burstLasers', 'Burst Lasers'), // 18
  t => t('game.upgrade.titanReactor', 'Titan Reactor'), // 19
  t => t('game.upgrade.ocularImplants', 'Ocular Implants'), // 20
  t => t('game.upgrade.moebiusReactor', 'Moebius Reactor'), // 21
  t => t('game.upgrade.apolloReactor', 'Apollo Reactor'), // 22
  t => t('game.upgrade.colossusReactor', 'Colossus Reactor'), // 23
  t => t('game.upgrade.ventralSacs', 'Ventral Sacs'), // 24
  t => t('game.upgrade.antennae', 'Antennae'), // 25
  t => t('game.upgrade.pneumatizedCarapace', 'Pneumatized Carapace'), // 26
  t => t('game.upgrade.metabolicBoost', 'Metabolic Boost'), // 27
  t => t('game.upgrade.adrenalGlands', 'Adrenal Glands'), // 28
  t => t('game.upgrade.muscularAugments', 'Muscular Augments'), // 29
  t => t('game.upgrade.groovedSpines', 'Grooved Spines'), // 30
  t => t('game.upgrade.gameteMeiosis', 'Gamete Meiosis'), // 31
  t => t('game.upgrade.metasynapticNode', 'Metasynaptic Node'), // 32
  t => t('game.upgrade.singularityCharge', 'Singularity Charge'), // 33
  t => t('game.upgrade.legEnhancements', 'Leg Enhancements'), // 34
  t => t('game.upgrade.scarabDamage', 'Scarab Damage'), // 35
  t => t('game.upgrade.reaverCapacity', 'Reaver Capacity'), // 36
  t => t('game.upgrade.graviticDrive', 'Gravitic Drive'), // 37
  t => t('game.upgrade.sensorArray', 'Sensor Array'), // 38
  t => t('game.upgrade.graviticBoosters', 'Gravitic Boosters'), // 39
  t => t('game.upgrade.khaydarinAmulet', 'Khaydarin Amulet'), // 40
  t => t('game.upgrade.apialSensors', 'Apial Sensors'), // 41
  t => t('game.upgrade.graviticThrusters', 'Gravitic Thrusters'), // 42
  t => t('game.upgrade.carrierCapacity', 'Carrier Capacity'), // 43
  t => t('game.upgrade.khaydarinCore', 'Khaydarin Core'), // 44
  undefined, // 45
  undefined, // 46
  t => t('game.upgrade.argusJewel', 'Argus Jewel'), // 47
  undefined, // 48
  t => t('game.upgrade.argusTalisman', 'Argus Talisman'), // 49
  undefined, // 50
  t => t('game.upgrade.caduceusReactor', 'Caduceus Reactor'), // 51
  t => t('game.upgrade.chitinousPlating', 'Chitinous Plating'), // 52
  t => t('game.upgrade.anabolicSynthesis', 'Anabolic Synthesis'), // 53
  t => t('game.upgrade.charonBoosters', 'Charon Boosters'), // 54
]

/** The name of each BW tech id, indexed by tech id. Ids the game doesn't use are left out. */
const TECHS: ReadonlyArray<((t: TFunction) => string) | undefined> = [
  t => t('game.tech.stimPacks', 'Stim Packs'), // 0
  t => t('game.tech.lockdown', 'Lockdown'), // 1
  t => t('game.tech.empShockwave', 'EMP Shockwave'), // 2
  t => t('game.tech.spiderMines', 'Spider Mines'), // 3
  t => t('game.tech.scannerSweep', 'Scanner Sweep'), // 4
  t => t('game.tech.tankSiegeMode', 'Tank Siege Mode'), // 5
  t => t('game.tech.defensiveMatrix', 'Defensive Matrix'), // 6
  t => t('game.tech.irradiate', 'Irradiate'), // 7
  t => t('game.tech.yamatoGun', 'Yamato Gun'), // 8
  t => t('game.tech.cloakingField', 'Cloaking Field'), // 9
  t => t('game.tech.personnelCloaking', 'Personnel Cloaking'), // 10
  t => t('game.tech.burrowing', 'Burrowing'), // 11
  t => t('game.tech.infestation', 'Infestation'), // 12
  t => t('game.tech.spawnBroodlings', 'Spawn Broodlings'), // 13
  t => t('game.tech.darkSwarm', 'Dark Swarm'), // 14
  t => t('game.tech.plague', 'Plague'), // 15
  t => t('game.tech.consume', 'Consume'), // 16
  t => t('game.tech.ensnare', 'Ensnare'), // 17
  t => t('game.tech.parasite', 'Parasite'), // 18
  t => t('game.tech.psionicStorm', 'Psionic Storm'), // 19
  t => t('game.tech.hallucination', 'Hallucination'), // 20
  t => t('game.tech.recall', 'Recall'), // 21
  t => t('game.tech.stasisField', 'Stasis Field'), // 22
  t => t('game.tech.archonWarp', 'Archon Warp'), // 23
  t => t('game.tech.restoration', 'Restoration'), // 24
  t => t('game.tech.disruptionWeb', 'Disruption Web'), // 25
  undefined, // 26
  t => t('game.tech.mindControl', 'Mind Control'), // 27
  t => t('game.tech.darkArchonMeld', 'Dark Archon Meld'), // 28
  t => t('game.tech.feedback', 'Feedback'), // 29
  t => t('game.tech.opticalFlare', 'Optical Flare'), // 30
  t => t('game.tech.maelstrom', 'Maelstrom'), // 31
  t => t('game.tech.lurkerAspect', 'Lurker Aspect'), // 32
  undefined, // 33
  t => t('game.tech.healing', 'Healing'), // 34
]

export function getUpgradeName(upgradeId: number, t: TFunction): string {
  return (
    UPGRADES[upgradeId]?.(t) ?? t('game.upgrade.unknown', 'Upgrade {{upgradeId}}', { upgradeId })
  )
}

export function getTechName(techId: number, t: TFunction): string {
  return TECHS[techId]?.(t) ?? t('game.tech.unknown', 'Tech {{techId}}', { techId })
}

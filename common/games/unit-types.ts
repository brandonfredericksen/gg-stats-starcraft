import { TFunction } from 'i18next'
import { AssignedRaceChar } from '../races'

/** BW unit ids from here on are buildings (along with some map doodads). */
const FIRST_BUILDING_ID = 106

/**
 * The name and race of each BW unit id that can show up in a game's stats, indexed by unit id.
 * Siege mode and tank mode share a name so they read as one kind of unit.
 */
const UNIT_TYPES: ReadonlyArray<[getName: (t: TFunction) => string, race?: AssignedRaceChar]> = [
  [t => t('game.unit.marine', 'Marine'), 't'], // 0
  [t => t('game.unit.ghost', 'Ghost'), 't'], // 1
  [t => t('game.unit.vulture', 'Vulture'), 't'], // 2
  [t => t('game.unit.goliath', 'Goliath'), 't'], // 3
  [t => t('game.unit.goliathTurret', 'Goliath Turret'), 't'], // 4
  [t => t('game.unit.siegeTankTank', 'Siege Tank'), 't'], // 5
  [t => t('game.unit.siegeTankTurret', 'Siege Tank Turret'), 't'], // 6
  [t => t('game.unit.scv', 'SCV'), 't'], // 7
  [t => t('game.unit.wraith', 'Wraith'), 't'], // 8
  [t => t('game.unit.scienceVessel', 'Science Vessel'), 't'], // 9
  [t => t('game.unit.guiMontag', 'Gui Montag'), 't'], // 10
  [t => t('game.unit.dropship', 'Dropship'), 't'], // 11
  [t => t('game.unit.battlecruiser', 'Battlecruiser'), 't'], // 12
  [t => t('game.unit.spiderMine', 'Spider Mine'), 't'], // 13
  [t => t('game.unit.nuclearMissile', 'Nuclear Missile'), 't'], // 14
  [t => t('game.unit.civilian', 'Civilian'), 't'], // 15
  [t => t('game.unit.sarahKerrigan', 'Sarah Kerrigan'), 't'], // 16
  [t => t('game.unit.alanSchezar', 'Alan Schezar'), 't'], // 17
  [t => t('game.unit.schezarTurret', 'Schezar Turret'), 't'], // 18
  [t => t('game.unit.jimRaynorVulture', 'Jim Raynor (Vulture)'), 't'], // 19
  [t => t('game.unit.jimRaynorMarine', 'Jim Raynor (Marine)'), 't'], // 20
  [t => t('game.unit.tomKazansky', 'Tom Kazansky'), 't'], // 21
  [t => t('game.unit.magellan', 'Magellan'), 't'], // 22
  [t => t('game.unit.edmundDukeTank', 'Edmund Duke (Siege Tank)'), 't'], // 23
  [t => t('game.unit.edmundDukeTankTurret', 'Edmund Duke Tank Turret'), 't'], // 24
  [t => t('game.unit.edmundDukeSiege', 'Edmund Duke (Siege Mode)'), 't'], // 25
  [t => t('game.unit.edmundDukeSiegeTurret', 'Edmund Duke Siege Turret'), 't'], // 26
  [t => t('game.unit.arcturusMengsk', 'Arcturus Mengsk'), 't'], // 27
  [t => t('game.unit.hyperion', 'Hyperion'), 't'], // 28
  [t => t('game.unit.noradIi', 'Norad II'), 't'], // 29
  [t => t('game.unit.siegeTankTank', 'Siege Tank'), 't'], // 30
  [t => t('game.unit.siegeTankTurret', 'Siege Tank Turret'), 't'], // 31
  [t => t('game.unit.firebat', 'Firebat'), 't'], // 32
  [t => t('game.unit.scannerSweep', 'Scanner Sweep'), 't'], // 33
  [t => t('game.unit.medic', 'Medic'), 't'], // 34
  [t => t('game.unit.larva', 'Larva'), 'z'], // 35
  [t => t('game.unit.egg', 'Egg'), 'z'], // 36
  [t => t('game.unit.zergling', 'Zergling'), 'z'], // 37
  [t => t('game.unit.hydralisk', 'Hydralisk'), 'z'], // 38
  [t => t('game.unit.ultralisk', 'Ultralisk'), 'z'], // 39
  [t => t('game.unit.broodling', 'Broodling'), 'z'], // 40
  [t => t('game.unit.drone', 'Drone'), 'z'], // 41
  [t => t('game.unit.overlord', 'Overlord'), 'z'], // 42
  [t => t('game.unit.mutalisk', 'Mutalisk'), 'z'], // 43
  [t => t('game.unit.guardian', 'Guardian'), 'z'], // 44
  [t => t('game.unit.queen', 'Queen'), 'z'], // 45
  [t => t('game.unit.defiler', 'Defiler'), 'z'], // 46
  [t => t('game.unit.scourge', 'Scourge'), 'z'], // 47
  [t => t('game.unit.torrasque', 'Torrasque'), 'z'], // 48
  [t => t('game.unit.matriarch', 'Matriarch'), 'z'], // 49
  [t => t('game.unit.infestedTerran', 'Infested Terran'), 'z'], // 50
  [t => t('game.unit.infestedKerrigan', 'Infested Kerrigan'), 'z'], // 51
  [t => t('game.unit.uncleanOne', 'Unclean One'), 'z'], // 52
  [t => t('game.unit.hunterKiller', 'Hunter Killer'), 'z'], // 53
  [t => t('game.unit.devouringOne', 'Devouring One'), 'z'], // 54
  [t => t('game.unit.kukulzaMutalisk', 'Kukulza (Mutalisk)'), 'z'], // 55
  [t => t('game.unit.kukulzaGuardian', 'Kukulza (Guardian)'), 'z'], // 56
  [t => t('game.unit.yggdrasill', 'Yggdrasill'), 'z'], // 57
  [t => t('game.unit.valkyrie', 'Valkyrie'), 't'], // 58
  [t => t('game.unit.cocoon', 'Cocoon'), 'z'], // 59
  [t => t('game.unit.corsair', 'Corsair'), 'p'], // 60
  [t => t('game.unit.darkTemplar', 'Dark Templar'), 'p'], // 61
  [t => t('game.unit.devourer', 'Devourer'), 'z'], // 62
  [t => t('game.unit.darkArchon', 'Dark Archon'), 'p'], // 63
  [t => t('game.unit.probe', 'Probe'), 'p'], // 64
  [t => t('game.unit.zealot', 'Zealot'), 'p'], // 65
  [t => t('game.unit.dragoon', 'Dragoon'), 'p'], // 66
  [t => t('game.unit.highTemplar', 'High Templar'), 'p'], // 67
  [t => t('game.unit.archon', 'Archon'), 'p'], // 68
  [t => t('game.unit.shuttle', 'Shuttle'), 'p'], // 69
  [t => t('game.unit.scout', 'Scout'), 'p'], // 70
  [t => t('game.unit.arbiter', 'Arbiter'), 'p'], // 71
  [t => t('game.unit.carrier', 'Carrier'), 'p'], // 72
  [t => t('game.unit.interceptor', 'Interceptor'), 'p'], // 73
  [t => t('game.unit.darkTemplarHero', 'Dark Templar Hero'), 'p'], // 74
  [t => t('game.unit.zeratul', 'Zeratul'), 'p'], // 75
  [t => t('game.unit.tassadarZeratul', 'Tassadar/Zeratul (Archon)'), 'p'], // 76
  [t => t('game.unit.fenixZealot', 'Fenix (Zealot)'), 'p'], // 77
  [t => t('game.unit.fenixDragoon', 'Fenix (Dragoon)'), 'p'], // 78
  [t => t('game.unit.tassadar', 'Tassadar'), 'p'], // 79
  [t => t('game.unit.mojo', 'Mojo'), 'p'], // 80
  [t => t('game.unit.warbringer', 'Warbringer'), 'p'], // 81
  [t => t('game.unit.gantrithor', 'Gantrithor'), 'p'], // 82
  [t => t('game.unit.reaver', 'Reaver'), 'p'], // 83
  [t => t('game.unit.observer', 'Observer'), 'p'], // 84
  [t => t('game.unit.scarab', 'Scarab'), 'p'], // 85
  [t => t('game.unit.danimoth', 'Danimoth'), 'p'], // 86
  [t => t('game.unit.aldaris', 'Aldaris'), 'p'], // 87
  [t => t('game.unit.artanis', 'Artanis'), 'p'], // 88
  [t => t('game.unit.rhynadon', 'Rhynadon')], // 89
  [t => t('game.unit.bengalaas', 'Bengalaas')], // 90
  [t => t('game.unit.cargoShip', 'Cargo Ship')], // 91
  [t => t('game.unit.mercenaryGunship', 'Mercenary Gunship')], // 92
  [t => t('game.unit.scantid', 'Scantid')], // 93
  [t => t('game.unit.kakaru', 'Kakaru')], // 94
  [t => t('game.unit.ragnasaur', 'Ragnasaur')], // 95
  [t => t('game.unit.ursadon', 'Ursadon')], // 96
  [t => t('game.unit.lurkerEgg', 'Lurker Egg'), 'z'], // 97
  [t => t('game.unit.raszagal', 'Raszagal')], // 98
  [t => t('game.unit.samirDuran', 'Samir Duran')], // 99
  [t => t('game.unit.alexeiStukov', 'Alexei Stukov')], // 100
  [t => t('game.unit.mapRevealer', 'Map Revealer')], // 101
  [t => t('game.unit.gerardDugalle', 'Gerard Dugalle')], // 102
  [t => t('game.unit.lurker', 'Lurker'), 'z'], // 103
  [t => t('game.unit.infestedDuran', 'Infested Duran')], // 104
  [t => t('game.unit.disruptionWeb', 'Disruption Web')], // 105
  [t => t('game.unit.commandCenter', 'Command Center'), 't'], // 106
  [t => t('game.unit.comsatStation', 'Comsat Station'), 't'], // 107
  [t => t('game.unit.nuclearSilo', 'Nuclear Silo'), 't'], // 108
  [t => t('game.unit.supplyDepot', 'Supply Depot'), 't'], // 109
  [t => t('game.unit.refinery', 'Refinery'), 't'], // 110
  [t => t('game.unit.barracks', 'Barracks'), 't'], // 111
  [t => t('game.unit.academy', 'Academy'), 't'], // 112
  [t => t('game.unit.factory', 'Factory'), 't'], // 113
  [t => t('game.unit.starport', 'Starport'), 't'], // 114
  [t => t('game.unit.controlTower', 'Control Tower'), 't'], // 115
  [t => t('game.unit.scienceFacility', 'Science Facility'), 't'], // 116
  [t => t('game.unit.covertOps', 'Covert Ops'), 't'], // 117
  [t => t('game.unit.physicsLab', 'Physics Lab'), 't'], // 118
  [t => t('game.unit.starbase', 'Starbase'), 't'], // 119
  [t => t('game.unit.machineShop', 'Machine Shop'), 't'], // 120
  [t => t('game.unit.repairBay', 'Repair Bay'), 't'], // 121
  [t => t('game.unit.engineeringBay', 'Engineering Bay'), 't'], // 122
  [t => t('game.unit.armory', 'Armory'), 't'], // 123
  [t => t('game.unit.missileTurret', 'Missile Turret'), 't'], // 124
  [t => t('game.unit.bunker', 'Bunker'), 't'], // 125
  [t => t('game.unit.noradIiCrashed', 'Norad II (Crashed)'), 't'], // 126
  [t => t('game.unit.ionCannon', 'Ion Cannon'), 't'], // 127
  [t => t('game.unit.urajCrystal', 'Uraj Crystal'), 't'], // 128
  [t => t('game.unit.khalisCrystal', 'Khalis Crystal'), 't'], // 129
  [t => t('game.unit.infestedCommandCenter', 'Infested Command Center'), 't'], // 130
  [t => t('game.unit.hatchery', 'Hatchery'), 'z'], // 131
  [t => t('game.unit.lair', 'Lair'), 'z'], // 132
  [t => t('game.unit.hive', 'Hive'), 'z'], // 133
  [t => t('game.unit.nydusCanal', 'Nydus Canal'), 'z'], // 134
  [t => t('game.unit.hydraliskDen', 'Hydralisk Den'), 'z'], // 135
  [t => t('game.unit.defilerMound', 'Defiler Mound'), 'z'], // 136
  [t => t('game.unit.greaterSpire', 'Greater Spire'), 'z'], // 137
  [t => t('game.unit.queensNest', "Queen's Nest"), 'z'], // 138
  [t => t('game.unit.evolutionChamber', 'Evolution Chamber'), 'z'], // 139
  [t => t('game.unit.ultraliskCavern', 'Ultralisk Cavern'), 'z'], // 140
  [t => t('game.unit.spire', 'Spire'), 'z'], // 141
  [t => t('game.unit.spawningPool', 'Spawning Pool'), 'z'], // 142
  [t => t('game.unit.creepColony', 'Creep Colony'), 'z'], // 143
  [t => t('game.unit.sporeColony', 'Spore Colony'), 'z'], // 144
  [t => t('game.unit.unusedZergBuilding1', 'Unused Zerg Building 1'), 'z'], // 145
  [t => t('game.unit.sunkenColony', 'Sunken Colony'), 'z'], // 146
  [t => t('game.unit.overmindWithShell', 'Overmind With Shell'), 'z'], // 147
  [t => t('game.unit.overmind', 'Overmind'), 'z'], // 148
  [t => t('game.unit.extractor', 'Extractor'), 'z'], // 149
  [t => t('game.unit.matureChrysalis', 'Mature Chrysalis'), 'z'], // 150
  [t => t('game.unit.cerebrate', 'Cerebrate'), 'z'], // 151
  [t => t('game.unit.cerebrateDaggoth', 'Cerebrate Daggoth'), 'z'], // 152
  [t => t('game.unit.unusedZergBuilding2', 'Unused Zerg Building 2'), 'z'], // 153
  [t => t('game.unit.nexus', 'Nexus'), 'p'], // 154
  [t => t('game.unit.roboticsFacility', 'Robotics Facility'), 'p'], // 155
  [t => t('game.unit.pylon', 'Pylon'), 'p'], // 156
  [t => t('game.unit.assimilator', 'Assimilator'), 'p'], // 157
  [t => t('game.unit.unusedProtossBuilding1', 'Unused Protoss Building 1'), 'p'], // 158
  [t => t('game.unit.observatory', 'Observatory'), 'p'], // 159
  [t => t('game.unit.gateway', 'Gateway'), 'p'], // 160
  [t => t('game.unit.unusedProtossBuilding2', 'Unused Protoss Building 2'), 'p'], // 161
  [t => t('game.unit.photonCannon', 'Photon Cannon'), 'p'], // 162
  [t => t('game.unit.citadelOfAdun', 'Citadel of Adun'), 'p'], // 163
  [t => t('game.unit.cyberneticsCore', 'Cybernetics Core'), 'p'], // 164
  [t => t('game.unit.templarArchives', 'Templar Archives'), 'p'], // 165
  [t => t('game.unit.forge', 'Forge'), 'p'], // 166
  [t => t('game.unit.stargate', 'Stargate'), 'p'], // 167
  [t => t('game.unit.stasisCell', 'Stasis Cell'), 'p'], // 168
  [t => t('game.unit.fleetBeacon', 'Fleet Beacon'), 'p'], // 169
  [t => t('game.unit.arbiterTribunal', 'Arbiter Tribunal'), 'p'], // 170
  [t => t('game.unit.roboticsSupportBay', 'Robotics Support Bay'), 'p'], // 171
  [t => t('game.unit.shieldBattery', 'Shield Battery'), 'p'], // 172
  [t => t('game.unit.khaydarinCrystalFormation', 'Khaydarin Crystal Formation')], // 173
  [t => t('game.unit.temple', 'Temple')], // 174
  [t => t('game.unit.xelnagaTemple', "Xel'Naga Temple")], // 175
  [t => t('game.unit.mineralField1', 'Mineral Field')], // 176
  [t => t('game.unit.mineralField1', 'Mineral Field')], // 177
  [t => t('game.unit.mineralField1', 'Mineral Field')], // 178
  [t => t('game.unit.cave', 'Cave')], // 179
  [t => t('game.unit.caveIn', 'Cave In')], // 180
  [t => t('game.unit.cantina', 'Cantina')], // 181
  [t => t('game.unit.miningPlatform', 'Mining Platform')], // 182
  [t => t('game.unit.independentCommandCenter', 'Independent Command Center')], // 183
  [t => t('game.unit.independentStarport', 'Independent Starport')], // 184
  [t => t('game.unit.jumpGateUnused', 'Jump Gate')], // 185
  [t => t('game.unit.ruins', 'Ruins')], // 186
  [t => t('game.unit.khaydarinCrystalFormationUnused', 'Khaydarin Crystal Formation')], // 187
  [t => t('game.unit.vespeneGeyser', 'Vespene Geyser')], // 188
  [t => t('game.unit.warpGate', 'Warp Gate')], // 189
  [t => t('game.unit.psiDisrupter', 'Psi Disrupter')], // 190
  [t => t('game.unit.zergMarker', 'Zerg Marker')], // 191
  [t => t('game.unit.terranMarker', 'Terran Marker')], // 192
  [t => t('game.unit.protossMarker', 'Protoss Marker')], // 193
  [t => t('game.unit.zergBeacon', 'Zerg Beacon')], // 194
  [t => t('game.unit.terranBeacon', 'Terran Beacon')], // 195
  [t => t('game.unit.protossBeacon', 'Protoss Beacon')], // 196
  [t => t('game.unit.zergFlagBeacon', 'Zerg Flag Beacon')], // 197
  [t => t('game.unit.terranFlagBeacon', 'Terran Flag Beacon')], // 198
  [t => t('game.unit.protossFlagBeacon', 'Protoss Flag Beacon')], // 199
  [t => t('game.unit.powerGenerator', 'Power Generator')], // 200
  [t => t('game.unit.overmindCocoon', 'Overmind Cocoon')], // 201
  [t => t('game.unit.darkSwarm', 'Dark Swarm')], // 202
  [t => t('game.unit.floorMissileTrap', 'Floor Missile Trap')], // 203
  [t => t('game.unit.floorHatch', 'Floor Hatch')], // 204
  [t => t('game.unit.leftUpperLevelDoor', 'Left Upper Level Door')], // 205
  [t => t('game.unit.rightUpperLevelDoor', 'Right Upper Level Door')], // 206
  [t => t('game.unit.leftPitDoor', 'Left Pit Door')], // 207
  [t => t('game.unit.rightPitDoor', 'Right Pit Door')], // 208
  [t => t('game.unit.floorGunTrap', 'Floor Gun Trap')], // 209
  [t => t('game.unit.leftWallMissileTrap', 'Left Wall Missile Trap')], // 210
  [t => t('game.unit.leftWallFlameTrap', 'Left Wall Flame Trap')], // 211
  [t => t('game.unit.rightWallMissileTrap', 'Right Wall Missile Trap')], // 212
  [t => t('game.unit.rightWallFlameTrap', 'Right Wall Flame Trap')], // 213
  [t => t('game.unit.startLocation', 'Start Location')], // 214
  [t => t('game.unit.flag', 'Flag')], // 215
  [t => t('game.unit.youngChrysalis', 'Young Chrysalis')], // 216
  [t => t('game.unit.psiEmitter', 'Psi Emitter')], // 217
  [t => t('game.unit.dataDisc', 'Data Disc')], // 218
  [t => t('game.unit.khaydarinCrystal', 'Khaydarin Crystal')], // 219
  [t => t('game.unit.mineralChunk1', 'Mineral Chunk 1')], // 220
  [t => t('game.unit.mineralChunk2', 'Mineral Chunk 2')], // 221
  [t => t('game.unit.vespeneOrb1', 'Vespene Orb 1')], // 222
  [t => t('game.unit.vespeneOrb2', 'Vespene Orb 2')], // 223
  [t => t('game.unit.vespeneSac1', 'Vespene Sac 1')], // 224
  [t => t('game.unit.vespeneSac2', 'Vespene Sac 2')], // 225
  [t => t('game.unit.vespeneTank1', 'Vespene Tank 1')], // 226
  [t => t('game.unit.vespeneTank2', 'Vespene Tank 2')], // 227
]

/** The SCV, Drone and Probe. */
const WORKER_UNIT_IDS: ReadonlySet<number> = new Set([7, 41, 64])

export interface UnitTypeInfo {
  name: string
  race?: AssignedRaceChar
  isBuilding: boolean
  isWorker: boolean
}

export function getUnitTypeInfo(unitId: number, t: TFunction): UnitTypeInfo {
  const [getName, race] = UNIT_TYPES[unitId] ?? [
    (t: TFunction) => t('game.unit.unknown', 'Unit {{unitId}}', { unitId }),
  ]
  return {
    name: getName(t),
    race,
    isBuilding: unitId >= FIRST_BUILDING_ID,
    isWorker: WORKER_UNIT_IDS.has(unitId),
  }
}

/** The supply each army unit takes, by unit id, where it isn't 1. */
const ARMY_UNIT_SUPPLY: Partial<Record<number, number>> = {
  2: 2, // Vulture
  3: 2, // Goliath
  5: 2, // Siege Tank
  8: 2, // Wraith
  9: 2, // Science Vessel
  11: 2, // Dropship
  12: 6, // Battlecruiser
  30: 2, // Siege Tank, sieged
  37: 0.5, // Zergling
  39: 4, // Ultralisk
  43: 2, // Mutalisk
  44: 2, // Guardian
  45: 2, // Queen
  46: 2, // Defiler
  47: 0.5, // Scourge
  58: 3, // Valkyrie
  60: 2, // Corsair
  61: 2, // Dark Templar
  62: 2, // Devourer
  63: 4, // Dark Archon
  65: 2, // Zealot
  66: 2, // Dragoon
  67: 2, // High Templar
  68: 4, // Archon
  69: 2, // Shuttle
  70: 3, // Scout
  71: 4, // Arbiter
  72: 6, // Carrier
  83: 4, // Reaver
  103: 2, // Lurker
}

/** The supply a unit takes, so units of different sizes can be weighed against each other. */
export function getUnitSupply(unitId: number): number {
  return ARMY_UNIT_SUPPLY[unitId] ?? 1
}

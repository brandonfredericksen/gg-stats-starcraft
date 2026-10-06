# GG Stats for StarCraft

Post game stats for StarCraft: Remastered.

Play a game, and a minute later GG Stats has the numbers: scoreboard, army and economy over time,
supply blocks, bases, units, and every player's build order. It works for Battle.net and
ShieldBattery games, and for any replay you already have.

It also keeps a page about you. Your record by matchup and map, your macro, who you play with and
against, and how all of it changes over your last hundred games.

## Download

Get the installer from [Releases](https://github.com/brandonfredericksen/gg-stats-starcraft/releases/latest).
It needs Windows 10 or 11 and StarCraft: Remastered.

The installer isn't signed yet, so Windows SmartScreen will warn about it. Click **More info**, then
**Run anyway**. GG Stats updates itself after that.

## How it works

A replay only holds each player's commands, so the game has to be played back to know what
happened. GG Stats starts a second, invisible copy of StarCraft from your install, loads the replay,
fast forwards to the end while reading the game's own numbers, then quits.

It takes 10 to 30 seconds at low priority. You don't need to close your own StarCraft, and it
doesn't need a Battle.net login. It never touches a StarCraft it didn't start, and it never joins
online games.

## Privacy

Your replays and stats stay on your computer. The only network request GG Stats makes is to check
GitHub for a new version, and you can turn that off in Settings.

## Building it yourself

You need Node.js 24, pnpm and Rust (with the `i686-pc-windows-msvc` and `x86_64-pc-windows-msvc`
targets).

```bash
pnpm run installall
```

```bash
pnpm run dist
```

The installer ends up in `dist/`. For development, `pnpm run local-dev` runs the app with hot
reload, and [AGENTS.md](./AGENTS.md) explains how the code fits together.

## Credits

GG Stats is built on [ShieldBattery](https://github.com/ShieldBattery/ShieldBattery) and uses its
game integration under the MIT license. Thanks to the ShieldBattery developers for making it open
source.

It finds its way around StarCraft with neivv's [scarf](https://github.com/neivv/scarf) and
[samase_scarf](https://github.com/neivv/samase_scarf), under the Apache 2.0 license.

GG Stats is not affiliated with or endorsed by ShieldBattery or Blizzard Entertainment. StarCraft is
a trademark of Blizzard Entertainment, Inc.

## License

MIT, see [LICENSE](./LICENSE). The licenses of everything GG Stats ships with are in
`THIRD_PARTY_NOTICES.md` next to the installed app.

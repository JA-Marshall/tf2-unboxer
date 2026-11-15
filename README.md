# TF2 Unboxer

Open Team Fortress 2 cases from a Steam account you own, watch up to ten of them unbox at once on a full-screen
animation, and see what each session made or lost.

- **One Docker container**, configured with environment variables. No database, no cloud account.
- **Demo mode** that needs no Steam account at all: a pretend backpack of Summer 2020 Cosmetic Cases.
- **Profit and loss page**: every session's cost (the case plus the key) against what came out, valued at Steam
  Community Market prices after Steam's fees. Prices are optional.
- Item names, grades and Unusual effects come from the game's own files; item pictures are Steam's own icons, loaded
  from Steam by your browser. No game art, fonts or sounds are included: the crates, light and sound are drawn and
  synthesised in the page.

> [!WARNING]
> **Opening a case uses up the key and the case for good.** There is no undo and no refund. Most cases return
> items worth far less than the key that opened them: expect to **lose money** on average. The page asks you to press
> Open twice before it spends anything, and opens at most `MAX_PER_OPEN` (10) cases a press. Never run it on an
> account whose keys you are not willing to lose.

## Try the demo (no Steam account)

You need [Docker](https://docs.docker.com/get-docker/).

```sh
git clone https://github.com/JA-Marshall/tf2-unboxer.git
cd tf2-unboxer
docker build -t tf2-unboxer .
docker run --rm -p 127.0.0.1:8080:8080 -e DEMO=1 tf2-unboxer
```

Open <http://localhost:8080>. The badge at the top says **DEMO**: the cases and keys are pretend, and every result
is marked as a demo. "Play the demo" replays a fixed sample batch; "Open" runs the whole flow against the pretend
account, so the profit page fills in too.

## Run it on your own account

### 1. What the account needs

- **TF2 in its library** (the game is free) and the **cases and keys in its TF2 backpack**. Getting items in by trade
  needs a Premium (non Free-to-Play) account with Steam Guard enabled; trade holds apply as usual.
- **Not in use elsewhere while the container runs.** Steam lets an account be in TF2 in one place only: if you start
  TF2 on the same account, the container loses the game coordinator until the game closes. An alt account is easiest.
- Nothing else: no Steam Web API key, no trading-site key, and no `identity_secret` (opening a case is
  not a trade, so nothing needs confirming).

### 2. Steam Guard

Pick one:

- **With the mobile authenticator's `shared_secret`** (recommended for an alt you run all the time). If you moved the
  authenticator to a tool such as [Steam Desktop Authenticator](https://github.com/Jessecar96/SteamDesktopAuthenticator)
  or [steamguard-cli](https://github.com/dyc3/steamguard-cli), the `shared_secret` is in its account file (the `.maFile`).
  Either mount the `.maFile` itself (it is only read, at start-up; the secret stays in memory and is never logged
  or copied):

  ```sh
  docker run ... -v /path/to/12345678901234567.maFile:/run/secrets/steam.maFile:ro \
    -e STEAM_MAFILE=/run/secrets/steam.maFile tf2-unboxer
  ```

  or copy its `shared_secret` value into `STEAM_SHARED_SECRET`. Either way the container makes its own codes. The
  `.maFile` must be **unencrypted** (SDA's encryption passkey off, or export it with steamguard-cli).
- **Without it.** Leave `STEAM_SHARED_SECRET` empty and run the container the first time **interactively** (`-it`,
  see below). Steam asks for the code from your email or phone in the console; type it. After that the container keeps
  a login token in its `/data` volume and signs in by itself.

Either way, after the first sign-in a login token is saved in `/data/refresh-token.txt`. **Treat that file like a
password**: anyone with it can sign in to the account. Delete it (or revoke the session on Steam) to sign the container
out.

### 3. Configure

```sh
cp .env.example .env
```

and fill in at least `STEAM_ACCOUNT_NAME`, `STEAM_PASSWORD` and `UI_PASSWORD`. **Never commit `.env`.**

| Variable | Default | What it does |
| --- | --- | --- |
| `STEAM_ACCOUNT_NAME` | | Steam login name of the account holding the cases and keys. Empty = demo. |
| `STEAM_PASSWORD` | | Its password (used for the first sign-in; a login token is used after that). |
| `STEAM_SHARED_SECRET` | | Optional. The authenticator's `shared_secret`, so Steam Guard codes are made for you. |
| `STEAM_MAFILE` | | Optional. Path (inside the container) of a mounted, unencrypted `.maFile`: its `shared_secret` is used, and its `account_name` when `STEAM_ACCOUNT_NAME` is empty. |
| `UI_PASSWORD` | | **Required** unless `DEMO=1`: the page can spend keys. The browser asks for it. |
| `UI_USER` | `admin` | User name for the page. |
| `DEMO` | | `1` runs the demo account even when Steam details are set. |
| `MAX_PER_OPEN` | `10` | Cases opened per press, 1 to 10. |
| `PRICES` | `on` | `off` turns price lookups off (the profit page then shows only the cost side you type). |
| `CURRENCY` | `USD` | Steam Market currency: `USD`, `GBP`, `EUR`, `CAD`, `AUD`, ... |
| `PRICE_TTL_HOURS` | `6` | How long a price is kept before it is read again. |
| `PORT` | `8080` | Port inside the container. |
| `DATA_DIR` | `/data` | Where the login token, the log of opened cases and the price cache are kept. |

### 4. Run

```sh
docker build -t tf2-unboxer .

# first run without a shared secret: interactive, so you can type the Steam Guard code
docker run -it --rm --env-file .env -v tf2-unboxer-data:/data -p 127.0.0.1:8080:8080 tf2-unboxer

# from then on (or straight away with a shared secret): in the background
docker run -d --name tf2-unboxer --restart unless-stopped --env-file .env \
  -v tf2-unboxer-data:/data -p 127.0.0.1:8080:8080 tf2-unboxer
```

With a `.maFile` (no Steam Guard code to type, ever):

```sh
docker run -d --name tf2-unboxer --restart unless-stopped --env-file .env \
  -v /path/to/your.maFile:/run/secrets/steam.maFile:ro -e STEAM_MAFILE=/run/secrets/steam.maFile \
  -v tf2-unboxer-data:/data -p 127.0.0.1:8080:8080 tf2-unboxer
```

Open <http://localhost:8080> and sign in with `UI_USER` / `UI_PASSWORD`. The badge says **LIVE · real keys**. Once the
container is connected to the TF2 game coordinator (about 10 to 30 seconds), the case and key menus list what the
backpack holds; the key a case names is picked for you. Choose how many, press **Open**, then press again within five
seconds to confirm. The animation plays while the cases open (each takes a few seconds on Steam's side), then lays out
everything that came out.

`docker logs -f tf2-unboxer` shows what it is doing. `docker stop tf2-unboxer` signs it out of Steam.

> The `-p 127.0.0.1:8080:8080` above keeps the page on your own machine. If you expose it to a network, put it
> behind HTTPS (a reverse proxy such as Caddy or nginx): the page's password is sent with every request.

## What it costs

- **One key and one case for every case opened.** Keys are bought on the Steam Market or from other players; the
  profit page uses the key's lowest Steam Market listing as its cost, and the case's lowest listing after fees (what
  selling it would have paid) as the case's cost. Type your own figures on the profit page if you paid something else.
- Nothing else: the container makes no paid API calls and needs no hosting beyond your own computer.

## The pages

- **Unbox** (`/`): open cases, play the demo, and watch any past batch again ("Watch"). On the screen itself: **Full
  screen**, **Sound** (off until you turn it on), and <kbd>Space</kbd> / <kbd>Enter</kbd> / <kbd>Esc</kbd> to skip to
  the items. Crates open lowest grade first, and an Unusual always goes last with the screen to itself.
- **Profit** (`/profit`): each session (one press of Open) with its cost, its worth on the Steam Market after fees, and
  the profit or loss; click a session for its items. An Unusual is counted but never valued: its price depends on its
  effect, and is left out rather than guessed.

### About prices

Prices come from the Steam Community Market's public price overview, by item name. It needs no key, but Steam allows
only a few requests a minute, so names are read one at a time a few seconds apart and kept for `PRICE_TTL_HOURS`. A
batch of new items fills in over a minute or two; the profit page refreshes itself. "Worth" is the lowest listing less
Steam's 5% fee and TF2's 10% fee. Items Steam does not list (or cannot be sold there) show no price and are left out of
the totals.

## What it stores

Everything lives in the `/data` volume:

- `refresh-token.txt`: the Steam login token (secret; see above).
- `unbox-log.json`: every case opened (last 2,000): when, which case and key, and what came out.
- `prices.json`: the price cache.
- `demo/`: the demo account's own log, kept apart from the real one.

## Development

```sh
npm install
DATA_DIR=./data-local npm run demo   # the demo on http://localhost:8080
npm test
```

`data/unbox-data.json` (item names, case grades, Unusual effect names, icon file names, which items are crates and
keys) is generated. After a TF2 update that adds a case, run `npm run gen-data` and commit the result.

Layout: `src/server.js` (HTTP and API), `src/bench.js` (Steam sign-in and opening, and the demo account),
`src/items.js` (reading game coordinator items), `src/show.js` (names, grades, demo batches), `src/pnl.js` (profit and
loss), `src/prices.js` (Steam Market prices), `public/unbox-show.js` (the animation: WebGL, canvas and Web Audio).

## Credits

- [steam-user](https://github.com/DoctorMcKay/node-steam-user), [steam-totp](https://github.com/DoctorMcKay/node-steam-totp)
  and [tf2](https://github.com/DoctorMcKay/node-tf2) by Alex Corn (DoctorMcKay), MIT: signing in to Steam, Steam Guard
  codes, and talking to the TF2 game coordinator.
- [SteamDatabase/GameTracking-TF2](https://github.com/SteamDatabase/GameTracking-TF2): the game's `items_game.txt` and
  `tf_english.txt`, read for case contents, grades and effect names.
- [danocmx/node-tf2-static-schema](https://github.com/danocmx/node-tf2-static-schema): a public copy of Steam's TF2
  item schema, read for item names and icon file names.

Team Fortress 2, Steam and the item names and icons are trademarks and property of Valve Corporation. This project is
not affiliated with or endorsed by Valve. Item icons are not included in this repository; your browser loads them from
Steam.

## Licence

[MIT](LICENSE)

# SheRides

Women-only ride-hailing web app: verified women passengers ↔ verified women drivers, with SOS, safety OTP,
route-deviation alerts, live trip sharing, an all-day geo-fence and masked chat. College final-year project.

## Installation (fresh machine: Windows or macOS Apple Silicon)

Everything runs inside Docker. You do **not** need Node.js, npm or MongoDB on your computer, only **Git** and
**Docker Desktop**. Follow the section for your computer, then continue at [Set up the project](#set-up-the-project).

### Windows 10 / 11 (64-bit)

1. **Install Git.** Download from https://git-scm.com/download/win and run the installer, keeping all default options.
2. **Install WSL 2** (Docker needs it). Open **PowerShell as Administrator** (Start menu → type `PowerShell` →
   right-click → *Run as administrator*) and run:
   ```powershell
   wsl --install
   ```
   Restart the computer when it asks. If it says WSL is already installed, run `wsl --update` instead.
3. **Install Docker Desktop.** Download *Docker Desktop for Windows (AMD64)* from
   https://www.docker.com/products/docker-desktop/ and run it. Keep **"Use WSL 2 instead of Hyper-V"** ticked.
   Restart if asked.
4. **Start Docker Desktop** from the Start menu, accept the terms, and wait until the bottom-left corner shows
   **Engine running** (green). You can skip signing in.
5. Open a normal (not admin) **PowerShell** window for the next steps.

> If Docker says *virtualization is disabled*, turn on **Intel VT-x / AMD-V (SVM)** in your BIOS/UEFI settings, then retry.

### macOS (Apple Silicon: M1 / M2 / M3 / M4)

1. **Install Git.** Open **Terminal** (⌘ + Space → type `Terminal`) and run:
   ```bash
   xcode-select --install
   ```
   Click *Install* in the pop-up and wait for it to finish. (If it says already installed, you're done.)
2. **Install Docker Desktop.** Download *Docker Desktop for Mac with Apple silicon* from
   https://www.docker.com/products/docker-desktop/, open the `.dmg`, and drag **Docker** into **Applications**.
3. **Start Docker** from Applications, accept the terms, allow it to install its helper when asked for your Mac
   password, and wait for the whale icon in the menu bar to say **Docker Desktop is running**. You can skip signing in.

### Check the tools

In PowerShell (Windows) or Terminal (macOS), each of these should print a version number:

```bash
git --version
```

```bash
docker --version
```

```bash
docker compose version
```

### Set up the project

Run these in PowerShell (Windows) or Terminal (macOS). Docker Desktop must be running.

1. **Download the code** (ask the repo owner to add you as a collaborator first if the repo is private; Git will
   open a browser window to sign in to GitHub):
   ```bash
   git clone https://github.com/linux-pilot/sheRides.git
   ```
   ```bash
   cd sheRides
   ```
2. **Create your settings file** from the template.

   macOS:
   ```bash
   cp .env.example .env
   ```
   Windows (PowerShell):
   ```powershell
   Copy-Item .env.example .env
   ```
3. **Set a secret key.** Open `.env` in any text editor (Notepad works: `notepad .env` on Windows,
   `open -e .env` on macOS) and replace `change-me` in `JWT_SECRET=change-me` with a long random string.
   Generate one with:

   macOS:
   ```bash
   openssl rand -hex 32
   ```
   Windows (PowerShell):
   ```powershell
   -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
   ```
   Leave every other line as it is: emails then go to the local Mailpit inbox, nothing is sent to real addresses.
4. **Build and start everything** (the first run downloads images and installs packages, about 5–10 minutes):
   ```bash
   docker compose up --build
   ```
   It is ready when the log shows `Mongo connected` and Vite printing `Local: http://localhost:3000/`.
   **Leave this window open**: closing it or pressing `Ctrl + C` stops the site.
5. **Load the demo accounts.** Open a **second** PowerShell/Terminal window, `cd` into the `sheRides` folder again,
   and run:
   ```bash
   docker compose run --rm server node seed.js --yes
   ```
   This **wipes the database** and fills it with demo data. Run it once on first setup; running it again later
   deletes any accounts and rides you created.
6. Open **http://localhost:3000** in your browser and sign in with a [demo account](#demo-accounts-password-sherides123).

### Everyday use

| Task | Command (run inside the `sheRides` folder) |
|---|---|
| Start the site | `docker compose up` (add `--build` after pulling changes that touch `package.json`) |
| Stop the site | `Ctrl + C` in the running window, or `docker compose down` from another window |
| Get the latest code | `git pull`, then `docker compose up --build` |
| Run the tests | `docker compose run --rm server node test.js` |
| Reset to fresh demo data | `docker compose run --rm server node seed.js --yes` (wipes everything) |

Code changes in `client/` and `server/` reload automatically while the site is running.

### Troubleshooting

- **`docker: command not found` / `cannot connect to the Docker daemon`**: Docker Desktop is not running. Start it and
  wait for *Engine running*.
- **`port is already allocated`** (3000, 5050 or 8025): another program uses that port. Close it, or stop old
  containers with `docker compose down`.
- **Sign-in fails right after setup**: you skipped step 5. Run the seed command.
- **Build fails with a network error**: check your internet connection and run `docker compose up --build` again.
- **Something is badly broken**: `docker compose down -v` deletes the containers *and the database*, then repeat
  steps 4–5.

## Quick reference (already set up)

```bash
cp .env.example .env            # then set JWT_SECRET to a long random string (openssl rand -hex 32)
docker compose up --build       # mongo + server + client + mailpit
docker compose run --rm server node seed.js --yes   # demo data — WIPES the database and uploads, incl. accounts you created
```

| What | URL |
|---|---|
| Website | http://localhost:3000 |
| API + WebSocket | http://localhost:5050 (`/ws`) |
| Email inbox (Mailpit, when `SMTP_HOST=mailpit`) | http://localhost:8025 |

**Email:** `.env.example` sends everything to the local Mailpit inbox. To send real email, set Gmail SMTP in `.env`
(`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, your address and a 16-character app password). Demo `@sherides.test`
addresses are never sent to a real server. Passengers get emails only for: driver assigned, trip receipt, cancellation;
emergency contacts get SOS and trip-sharing emails.

**Maps & fares** use real road routes from OSRM (OpenStreetMap routing): fare distance, ETA, the route line on the map,
and route-deviation checks all follow the road. If OSRM is unreachable, it falls back to a straight line.

The API container listens on 5000; it is published on host port 5050 because macOS AirPlay Receiver owns 5000. The website reaches the API through
its own `/api` path (Vite forwards it, WebSocket included).

## Demo accounts (password `SheRides@123`)

| Role | Email |
|---|---|
| Passenger | `ananya@sherides.test`, `sneha@sherides.test` (`farah@` is blocked) |
| Driver | `priya@sherides.test` (approved) · `neha@`, `pooja@`, `rekha@sherides.test` (pending; Rekha has no licence) |
| Admin | `admin@sherides.test` |
| Support | `asha@sherides.test` |

**Demo the safety features:** sign in as Ananya in one browser and Priya in another (or a private window).
Ananya books Home → Work; Priya goes online, accepts, enters Ananya's OTP, taps *Start trip*, then
*Drive with detour* under **Demo GPS** — Ananya and the admin control room get a route-deviation alert.
Press **SOS** to email emergency contacts (see Mailpit) and alert the admin.

## Tests

```bash
docker compose run --rm server node test.js
```

Covers role middleware, JWT checks, input validation, upload type detection, fare calculation, OTP,
route-deviation distance and the geo-fence.

## Demo-scale stand-ins (`ponytail:` comments in code)

Mock wallet top-up (→ Razorpay), mock police call and masked calling (→ Twilio), public OSRM demo server
(→ self-hosted OSRM), JWT in localStorage and WebSocket URL (→ httpOnly cookie), one fixed service area
(→ admin-editable zones). Dev-mode containers only (→ multi-stage production build + nginx).

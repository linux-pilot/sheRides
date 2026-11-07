# SheRides

Women-only ride-hailing web app: verified women passengers ↔ verified women drivers, with SOS, safety OTP,
route-deviation alerts, live trip sharing, night geo-fence and masked chat. College final-year project.

## Run (Docker only)

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
route-deviation distance and the night geo-fence.

## Demo-scale stand-ins (`ponytail:` comments in code)

Mock wallet top-up (→ Razorpay), mock police call and masked calling (→ Twilio), public OSRM demo server
(→ self-hosted OSRM), JWT in localStorage and WebSocket URL (→ httpOnly cookie), one fixed service area
(→ admin-editable zones). Dev-mode containers only (→ multi-stage production build + nginx).

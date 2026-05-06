# Next.js + Firebase Queuing System

Flow included:

1. Kiosk start page with background image.
2. Service cards: Business Permit, Working Permit, PWD/Senior Citizen ID, Civil Registry Documents, etc.
3. Auto-generated queue number by service prefix, e.g. `BP-001`.
4. Optional name and phone input.
5. PWD/Senior Citizen priority selection.
6. Browser print preview for the ticket after clicking **Fall in Line**.
7. Display monitor shows current counters, next queue, and completed list.
8. Counter screen supports adding/removing counters, call next, complete current, and recall.
9. Firebase Firestore realtime sync.

## Setup

```bash
npm install
copy .env.example .env
npm run dev
```

Fill your Firebase config inside `.env`.

Open:

- `http://localhost:3000/kiosk`
- `http://localhost:3000/display`
- `http://localhost:3000/counter`
- `http://localhost:3000/setup`
- `http://localhost:3000/login`
- `http://localhost:3000/admin`
- `http://localhost:3000/superadmin`

## Admin flow

1. Open `/setup` once and create the first superadmin account.
2. Sign in at `/login`.
3. The superadmin opens `/superadmin` and creates admin accounts.
4. Admins open `/admin` to add services and seed the default services.
5. Admins open `/counter` to add counters. Each counter gets a 6-digit pairing code.
6. A counter browser opens `/counter`, enters the pairing code, and controls only that paired counter.

## Build

```bash
npm run build
npm start
```

## Firestore collections

- `queueTickets`
- `queueCounters`
- `queueSequences`
- `services`
- `users`

## Security rules

`firestore.rules` contains a starter ruleset for:

- superadmin-only admin account management
- admin/superadmin service and counter management
- public kiosk ticket creation
- public display reads
- paired counter write support

Review and deploy the rules before production use.

## Firestore suggested index

For best performance, create a composite index for `queueTickets`:

- `status` ascending
- `serviceDate` ascending
- `priorityRank` ascending
- `createdAt` ascending

If Firebase shows an index error in console, click the generated link to create it.

## Background image

Replace:

```txt
public/assets/kiosk-bg.jpg
```

Or update the CSS `background-image` URL in `src/app/globals.css`.

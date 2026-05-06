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

## Build

```bash
npm run build
npm start
```

## Firestore collections

- `queueTickets`
- `queueCounters`
- `queueSequences`

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

# Electron + Firebase Queuing System

Flow included:

1. Kiosk start page with background image.
2. Service cards: Business Permit, Working Permit, PWD/Senior Citizen ID, Civil Registry Documents, etc.
3. Auto-generated queue number by service prefix, e.g. `BP-001`.
4. Optional name and phone input.
5. PWD/Senior Citizen priority selection.
6. Print ticket after clicking **Fall in Line**.
7. Display monitor shows current counters, next queue, and completed list.
8. Counter screen supports 4 counters: call next, complete current, recall.
9. Firebase Firestore realtime sync.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Fill your Firebase config inside `.env`.

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
src/renderer/assets/kiosk-bg.jpg
```

Or update the CSS `background-image` URL in `styles.css`.

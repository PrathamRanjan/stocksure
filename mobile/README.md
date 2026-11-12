# StockSure mobile

The StockSure app for iPhone and Android, built with Expo (SDK 58) and React Native. It covers the three people in the flow:

- **Owner** (Jordan): orders, accepts quotes (PayPal hold), approves held payments and the agreed settlement.
- **Receiving** (Sam): counts the delivery at the door with the camera, docket file or pasted text, then confirms counts.
- **Supplier** (Ana): sends quotes, dispatches with an invoice, agrees or disputes each counted line, approves the settlement.

Creating new orders, the catalog, stock and spending rules stay on the website; the app opens those pages in an in-app browser.

## How it talks to the server

It uses the same contract as the web front end, so there is no second API:

- views come from `GET /api/ui/*` (`src/web/ui-api.ts`);
- actions are the existing form handlers, sent with `X-StockSure-UI: 1` so the server answers `{ ok, message, to }` instead of redirecting (`src/lib/client.ts`);
- the session is the server's cookie. Money is never computed in the app: every amount on screen comes from the server.

The server address defaults to the live sandbox (`https://pph-stocksure.onrender.com`). Set `EXPO_PUBLIC_STOCKSURE_URL` or change it from Account → Server.

## Run it

```bash
npm install
npx expo start          # then press i (iOS simulator), a (Android) or scan the QR code with Expo Go
```

Camera, photo library and file picking need a device or simulator. Haptics are iOS and Android only.

### In a desktop browser, against a local hermetic server

```bash
# terminal 1, from the repo root: in-memory database, fake PayPal, demo seed
E2E_PORT=4472 SS_DEMO_MODE=1 npx tsx scripts/e2e-server.ts
# terminal 2, from mobile/
npx expo export -p web && node scripts/web-preview.mjs   # http://localhost:8471
```

`scripts/web-preview.mjs` serves the web build and proxies the server's routes on the same origin so the session cookie works.

## Checks

```bash
npm run typecheck
npm test                     # client contract, route mapping, tally and money-bar maths
node scripts/screens.mjs     # phone screenshots, light and dark, into docs/screenshots (needs the preview running)
node scripts/icons.mjs       # app icon set from the tally mark
```

## Design

The "Docket" system from the website, rebuilt natively (`src/components/`):

- paper, ink and carbon-copy blue, with PayPal states as rubber stamps;
- Archivo Expanded for display type: a static width-118 cut of Archivo (OFL, `assets/fonts/OFL-Archivo.txt`) with Source Sans 3 for text;
- the tally strip (one mark per pack) and the settlement bar;
- light and dark follow the system, or are set in Account;
- Dynamic Type is respected (display sizes capped), touch targets are at least 44 pt, Reduce Motion turns off the stamp and bar animations, and toasts are announced to screen readers.

## Verified

- The whole loop was driven through the app's web build against the hermetic server, switching between the three people: quote, accept (hold), dispatch with the injected-instruction invoice, count with the "two crushed" docket, supplier agrees, both approve, then capture, release and a replacement hold.
- Screenshots of that run are in `docs/screenshots/`.
- Not run on a physical device or a native simulator: this machine has no Xcode or Android SDK. Native-only paths (camera, photo library, haptics, the native header and blur) are written to the Expo SDK 58 APIs but are untested here.

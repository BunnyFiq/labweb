# Haze · Malaysia air quality

Haze displays the latest published Malaysia Air Pollutant Index (API/IPU) readings from the Department of Environment's MyEQMS/APIMS monitoring network. The default city cards and the Malaysia-wide search use real station observations; the interface names the station and its approximate distance instead of presenting a nearby measurement as a city-wide reading.

The current APIMS station endpoint supplies the Malaysian index, category, dominant pollutant, and observation time. It does not supply individual pollutant concentrations in that response, so Haze discloses that rather than substituting modelled values. Hourly detail charts use APIMS station history. Measurements are marked stale after two hours, and readings refresh hourly to match the source's publication cadence.

## Zero-cost deployment

- Firebase Hosting can remain on the Spark plan for the static website. It no longer runs or rewrites to Cloud Functions.
- The API runs as a Cloudflare Worker on the Workers Free plan. Cloudflare says the Free plan is available by default; its published [pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [limits](https://developers.cloudflare.com/workers/platform/limits/) are 100,000 Worker requests per day, 10 ms CPU per request, 128 MB memory, and 50 upstream subrequests per request. Default-city readings are sent as sequential batches of 8 and 4; each Worker request can make at most 48 DOE subrequests, including retries. The integration uses no paid plan, payment card, API key, or secret.
- The static site calls the Worker at its public `workers.dev` URL. This read-only API has no credentials and enables non-credentialed CORS for all origins. It only accepts the fixed reading/history routes; it is not a general-purpose proxy.
- The Worker caches successful readings and history for five minutes with Cloudflare's Cache API. DOE lookups are also cached within a warm Worker instance. Upstream DOE calls are serialized and spaced by 250 ms per instance, with up to two backoff retries for rate limiting.

The DOE endpoints respond to browsers with `Access-Control-Allow-Origin: https://eqmp.doe.gov.my`, not this website's origin, so browser requests to the DOE API are blocked by CORS. The public MyEQMS portal documents the readings, but no separate public API usage/license terms were found. The API is an undocumented public portal interface and may change or rate-limit access; this app makes no claim of an SLA or official DOE endorsement.

Search suggestions use the GeoNames Malaysia gazetteer bundled in the website, so typing and autocomplete do not call a geocoding service. The source database was retrieved on 2026-10-15 and is licensed under CC BY 4.0; the app links to the attribution and license. The public OpenStreetMap Nominatim service is intentionally not used because its [usage policy prohibits autocomplete](https://operations.osmfoundation.org/policies/nominatim/).

## Requirements and setup

- Node.js and npm.
- Firebase CLI for Spark Hosting deployment.
- Cloudflare account with the Workers Free plan and Wrangler login for the separate API deployment. Cloudflare's current Workers documentation says Free is available by default and documents $0 usage within its limits; this repository does not configure billing or upgrade to a paid plan.

Install dependencies and start the Worker emulator and website in separate terminals:

```sh
npm install
npm run dev:api
npm run dev
```

The Vite `/api` proxy forwards to the local Wrangler server at `127.0.0.1:8787`. Search works from the bundled gazetteer without the Worker; live readings and history require the Worker.

## Tests and deployment

```sh
npm run lint
npm run build
npm run test:api
npm run deploy:api
```

After deploying, set the `workers.dev` URL Wrangler reports in `.env.production` as `VITE_API_BASE_URL`, then build and deploy the static site. The currently deployed endpoint is `https://haze-malaysia-api.223194.workers.dev`. For a different Cloudflare account, replace that URL with the host assigned by Wrangler:

```sh
VITE_API_BASE_URL=https://haze-malaysia-api.<your-workers-subdomain>.workers.dev
npm run build
firebase deploy --only hosting --project haze-75b87
```

Do not include `/api` at the end. This Worker deployment and the Firebase Hosting deployment are separate.

## Updating the bundled city database

Download the current [GeoNames Malaysia country extract](https://download.geonames.org/export/dump/MY.zip), update `src/data/malaysian-settlements.json` from its populated-place entries and the GeoNames administrative-division names, and keep its GeoNames CC BY 4.0 attribution. This dataset contains place names and coordinates only; it contains no air-quality readings.

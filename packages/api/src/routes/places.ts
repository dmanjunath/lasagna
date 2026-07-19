import { Hono } from "hono";
import { type AuthEnv } from "../middleware/auth.js";

// Server-side proxy for the Google Places API (New), so the API key stays off
// the client. Session-authenticated like any user route (registered under the
// global auth guard). Returns only the fields the address picker needs.
export const placesRoutes = new Hono<AuthEnv>();

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";

placesRoutes.get("/autocomplete", async (c) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return c.json({ error: "Address lookup is not configured" }, 503);

  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ predictions: [] });

  const res = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ input: q }),
  });
  if (!res.ok) return c.json({ error: "Address lookup failed" }, 502);
  const data = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: { placeId?: string; text?: { text?: string } };
    }>;
  };

  const predictions = (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is { placeId: string; text: { text: string } } =>
      Boolean(p?.placeId && p?.text?.text),
    )
    .map((p) => ({ description: p.text.text, placeId: p.placeId }));
  return c.json({ predictions });
});

placesRoutes.get("/details", async (c) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return c.json({ error: "Address lookup is not configured" }, 503);

  const placeId = c.req.query("placeId")?.trim();
  if (!placeId) return c.json({ error: "placeId is required" }, 400);

  const res = await fetch(`${DETAILS_URL}/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "id,formattedAddress,location,types",
    },
  });
  if (!res.ok) return c.json({ error: "Address lookup failed" }, 502);
  const data = (await res.json()) as {
    id?: string;
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    types?: string[];
  };

  // Homes come back as address types (premise, street_address, …); businesses
  // carry "establishment" / "point_of_interest". We surface both the raw types
  // and a computed flag so the client can reject commercial addresses.
  const types = Array.isArray(data.types) ? data.types : [];
  const isBusiness = types.includes("establishment") || types.includes("point_of_interest");

  return c.json({
    address: data.formattedAddress ?? null,
    placeId: data.id ?? placeId,
    lat: typeof data.location?.latitude === "number" ? data.location.latitude : null,
    lng: typeof data.location?.longitude === "number" ? data.location.longitude : null,
    types,
    isBusiness,
  });
});

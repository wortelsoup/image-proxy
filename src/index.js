import { Hono } from "hono";

const MAX_SERVER_CACHE = 60 * 60 * 24 * 30; // valid for 30 days
const MAX_STALE_CACHE = 60 * 60 * 24 * 7; // plus 7 days before expired
const MAX_BROWSER_CACHE = 60 * 60 * 24; // browser can cache for 24 hours

const app = new Hono();

async function getImageVariantUrl(db, id, variant) {
  return db
    .prepare(`SELECT image_sources.${variant} FROM image_sources WHERE id = ?`)
    .bind(id)
    .first();
}

async function getImageProxy(urlOrigin, { ifNoneMatch, range } = {}) {
  const image = await fetch(urlOrigin, {
    headers: {
      ...(range && { Range: range }),
      ...(ifNoneMatch && { "If-None-Match": ifNoneMatch }),
    },
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: { "200-299": MAX_SERVER_CACHE, 404: 10, "500-599": 0 },
    },
  });

  const res = new Response(image.body, image);
  res.headers.set("Cache-Control",`public, max-age=${MAX_BROWSER_CACHE}, s-maxage=${MAX_SERVER_CACHE}, stale-while-revalidate=${MAX_STALE_CACHE}`);
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.append("Vary", "Accept");
  res.headers.delete("Via");
  res.headers.delete("Set-Cookie");

  return res;
}

app.get("/image-not-available-yet.webp", async (c) => {
  const ifNoneMatch = c.req.header("If-None-Match");
  const range = c.req.header("Range");
  return await getImageProxy(c.env.IMG_FALLBACK_URL, { ifNoneMatch, range });
});

app.get("/:imageId{[0-9a-fA-F-]+\\.webp}", async (c) => {
  const imageId = c.req.param("imageId");
  const variant = c.req.query("q")?.trim() ?? "hd";

  if (!/hd|md/.test(variant)) return c.notFound();

  const ifNoneMatch = c.req.header("If-None-Match");
  const range = c.req.header("Range");

  const imageVariantUrl = await getImageVariantUrl(
    c.env.DB,
    imageId.replace(/\.webp$/, ""),
    variant,
  );

  if (!imageVariantUrl) {
    return c.redirect("/image-not-available-yet.webp");
  }

  return await getImageProxy(imageVariantUrl[variant], { ifNoneMatch, range });
});

app.onError((err, c) => {
  if ("message" in err) {
    return c.text(err.message, 500);
  }
  return c.text("Internal server error", 500);
});

export default app;

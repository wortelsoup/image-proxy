import { Hono } from "hono";

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
      cacheTtlByStatus: { "200-299": 2592000, 404: 10, "500-599": 0 },
    },
  });

  const res = new Response(image.body, image);
  res.headers.set(
    "Cache-Control",
    "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800",
  );
  res.headers.append("Vary", "Accept");

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

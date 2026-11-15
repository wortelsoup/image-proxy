import { Hono } from "hono";

const app = new Hono();

async function getImageVariantUrl(db, id, variant) {
  return db
    .prepare(`SELECT image_sources.${variant} FROM image_sources WHERE id = ?`)
    .bind(id)
    .first();
}

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

  const image = await fetch(imageVariantUrl[variant] || c.env.IMG_FALLBACK_URL, {
    headers: {
      ...(range && { Range: range }),
      ...(ifNoneMatch && { "If-None-Match": ifNoneMatch }),
    },
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: { "200-299": 120, 404: 1, "500-599": 0 },
    },
  });

  const res = new Response(image.body, image);
  res.headers.set(
    "Cache-Control",
    "public, max-age=60, s-maxage=120, stale-while-revalidate=60",
  );

  return res;
});

app.onError((err, c) => {
  if ("message" in error) {
    return c.text(err.message, 500);
  }
  return c.text("Internal server error", 500);
});

export default app;

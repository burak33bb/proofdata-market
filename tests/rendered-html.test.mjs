import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ProofData marketplace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ProofData/);
  assert.match(html, /Trusted data/);
  assert.match(html, /Ready for intelligence/);
  assert.match(html, /Data worth building on/);
  assert.match(html, /Proof, not promises/i);
  assert.match(html, /ShelbyNet/);
  assert.match(html, />Faucet</);
  assert.match(html, /Loading the marketplace/);
  assert.doesNotMatch(html, /<kbd>⌘ K<\/kbd>/);
  assert.doesNotMatch(html, /1,000 rows previewable/);
  assert.doesNotMatch(html, /timestamp.*region_id.*signal.*confidence/s);
  assert.doesNotMatch(html, /Urban Mobility Pulse/);
  assert.doesNotMatch(html, /Use dark mode/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("includes product metadata and the bespoke social preview", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /The verifiable data layer for AI/);
  assert.match(html, /\/og\.png/);
  assert.match(html, /summary_large_image/);
});

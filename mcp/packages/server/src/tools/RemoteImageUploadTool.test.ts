import assert from "node:assert/strict";
import test from "node:test";
import { RemoteImageUploadTool } from "./RemoteImageUploadTool";

// A minimal valid 1x1 PNG, base64 encoded.
const SMALL_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

function compilesAsFunctionBody(code: string): void {
    // Compiling (but not running) verifies the generated JS body is syntactically
    // valid; a broken-out/injected payload would throw a SyntaxError here.
    assert.doesNotThrow(() => new Function("penpotUtils", `return (async () => { ${code} })();`));
}

test("valid small PNG base64 is accepted and normalized", () => {
    const normalized = RemoteImageUploadTool.normalizeBase64(SMALL_PNG_B64);
    assert.equal(normalized, SMALL_PNG_B64);
});

test("base64 with whitespace is stripped and accepted", () => {
    const withWs = "iVBORw0KGgo\nAAAANSUhEUgAAAAEAAAAB\n CAIAAACQd1Pe";
    const normalized = RemoteImageUploadTool.normalizeBase64(withWs);
    assert.ok(!/\s/.test(normalized));
});

test("invalid base64 is rejected", () => {
    assert.throws(() => RemoteImageUploadTool.normalizeBase64("not base64!!!"), /Invalid base64/);
});

test("empty base64 is rejected", () => {
    assert.throws(() => RemoteImageUploadTool.normalizeBase64(""), /Invalid base64/);
});

test("a data URI is rejected with a clear message", () => {
    assert.throws(() => RemoteImageUploadTool.normalizeBase64("data:image/png;base64," + SMALL_PNG_B64), /data URI/);
});

test("base64DecodedLength computes the decoded size without decoding", () => {
    const expected = Buffer.from(SMALL_PNG_B64, "base64").length;
    assert.equal(RemoteImageUploadTool.base64DecodedLength(SMALL_PNG_B64), expected);
    assert.ok(expected > 0);
});

test("assertWithinSizeLimit accepts a payload at or below the limit", () => {
    const size = RemoteImageUploadTool.base64DecodedLength(SMALL_PNG_B64);
    assert.doesNotThrow(() => RemoteImageUploadTool.assertWithinSizeLimit(SMALL_PNG_B64, size));
    assert.equal(RemoteImageUploadTool.assertWithinSizeLimit(SMALL_PNG_B64, size + 1000), size);
});

test("assertWithinSizeLimit rejects a payload above the limit", () => {
    assert.throws(() => RemoteImageUploadTool.assertWithinSizeLimit(SMALL_PNG_B64, 10), /exceeds the maximum/);
});

test("resolveMimeType passes an explicit mime_type through unchanged", () => {
    assert.equal(RemoteImageUploadTool.resolveMimeType("logo.png", "image/png"), "image/png");
});

test("resolveMimeType infers from the filename extension", () => {
    assert.equal(RemoteImageUploadTool.resolveMimeType("logo.png"), "image/png");
    assert.equal(RemoteImageUploadTool.resolveMimeType("photo.jpg"), "image/jpeg");
    assert.equal(RemoteImageUploadTool.resolveMimeType("image.webp"), "image/webp");
    assert.equal(RemoteImageUploadTool.resolveMimeType("image.gif"), "image/gif");
});

test("resolveMimeType falls back to a default for an unknown/no extension", () => {
    assert.equal(RemoteImageUploadTool.resolveMimeType("image"), RemoteImageUploadTool.DEFAULT_MIME_TYPE);
    assert.equal(RemoteImageUploadTool.resolveMimeType("logo.xyz"), RemoteImageUploadTool.DEFAULT_MIME_TYPE);
});

test("buildImportCode produces valid JS for a safe filename", () => {
    const code = RemoteImageUploadTool.buildImportCode(
        SMALL_PNG_B64,
        "image/png",
        "logo.png",
        0,
        0,
        undefined,
        undefined
    );
    compilesAsFunctionBody(code);
    assert.ok(code.includes("penpotUtils.importImage"));
    assert.ok(code.includes("rectangle.width"));
});

test("generated JS cannot be injected via a path-traversal filename", () => {
    const code = RemoteImageUploadTool.buildImportCode(
        SMALL_PNG_B64,
        "image/png",
        "../../logo.png",
        0,
        0,
        undefined,
        undefined
    );
    compilesAsFunctionBody(code);
    assert.ok(code.includes(JSON.stringify("../../logo.png")));
});

test("generated JS cannot be injected via a single-quote payload filename", () => {
    const evil = "'); malicious code";
    const code = RemoteImageUploadTool.buildImportCode(SMALL_PNG_B64, "image/png", evil, 0, 0, undefined, undefined);
    compilesAsFunctionBody(code);
    // the malicious fragment must remain inside the string literal, never executed
    assert.ok(code.includes(JSON.stringify(evil)));
});

test("generated JS cannot be injected via an escaped-quote payload filename", () => {
    const evil = '\\" ); malicious code';
    const code = RemoteImageUploadTool.buildImportCode(SMALL_PNG_B64, "image/png", evil, 0, 0, undefined, undefined);
    compilesAsFunctionBody(code);
    assert.ok(code.includes(JSON.stringify(evil)));
});

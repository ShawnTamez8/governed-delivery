import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";

test("key insertion order does not change the serialization", () => {
  const a = { b: 1, a: 2, c: 3 };
  const b = { c: 3, a: 2, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"a":2,"b":1,"c":3}');
});

test("nested objects and objects inside arrays sort too", () => {
  const value = { outer: { z: 1, a: { y: 2, b: 3 } }, list: [{ n: 1, m: 2 }] };
  assert.equal(canonicalJson(value), '{"list":[{"m":2,"n":1}],"outer":{"a":{"b":3,"y":2},"z":1}}');
});

test("array order is preserved", () => {
  assert.equal(canonicalJson(["c", "a", "b"]), '["c","a","b"]');
});

test("undefined as an object value throws instead of vanishing", () => {
  assert.throws(() => canonicalJson({ a: 1, b: undefined }), /canonical JSON cannot serialize undefined/);
});

test("a function as an object value throws instead of vanishing", () => {
  assert.throws(() => canonicalJson({ a: () => 1 }), /canonical JSON cannot serialize function/);
});

test("a non-finite number throws", () => {
  assert.throws(() => canonicalJson({ a: NaN }), /canonical JSON cannot serialize a non-finite number/);
  assert.throws(() => canonicalJson({ a: Infinity }), /canonical JSON cannot serialize a non-finite number/);
});

test("normalizeText converts CRLF, strips a BOM, and leaves LF text alone", () => {
  assert.equal(normalizeText("a\r\nb\r\n"), "a\nb\n");
  assert.equal(normalizeText("﻿feature: x"), "feature: x");
  assert.equal(normalizeText("a\nb\n"), "a\nb\n");
});

test("a spec differing only by line endings hashes identically", () => {
  const lf = "feature: x\nchange_kind: feature\n";
  assert.equal(sha256Hex(normalizeText(lf)), sha256Hex(normalizeText(lf.replace(/\n/g, "\r\n"))));
});

test("sha256Hex matches the published empty-string digest", () => {
  // An external constant, not a value invented alongside this code.
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("sha256Hex accepts bytes as well as text", () => {
  assert.equal(sha256Hex(Buffer.from("", "utf8")), sha256Hex(""));
});

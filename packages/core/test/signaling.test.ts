import assert from "node:assert/strict";
import test from "node:test";
import { parseInviteUrl } from "../src/signaling.js";

test("parses invite links with encoded tokens", () => {
  assert.deepEqual(
    parseInviteUrl("https://golive.example/room/roomAAAA?source=share&token=abc%2Edef"),
    { roomId: "roomAAAA", inviteToken: "abc.def" },
  );
});

test("rejects invite links with malformed percent escapes", () => {
  assert.equal(parseInviteUrl("https://golive.example/room/roomAAAA?token=%"), null);
});

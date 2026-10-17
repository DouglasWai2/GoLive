const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const nativeDir = __dirname;
const service = fs.readFileSync(path.join(nativeDir, "VoiceSessionService.kt"), "utf8");
const moduleSource = fs.readFileSync(path.join(nativeDir, "VoiceSessionModule.kt"), "utf8");
const queue = fs.readFileSync(path.join(nativeDir, "VoiceSessionActionQueue.kt"), "utf8");

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  assert.fail(`unterminated ${signature}`);
}

test("stale notification actions and mismatched stop/update never stop a live other session", () => {
  const notification = functionBody(service, "private fun handleNotificationAction(");
  const stop = functionBody(service, "private fun handleStop(");
  const update = functionBody(service, "private fun handleUpdate(");
  const stopFromModule = functionBody(service, "internal fun stopFromModule(");
  const stopIfIdle = functionBody(service, "private fun stopIfIdle(");

  for (const body of [notification, stop, update]) {
    assert.match(body, /stopIfIdle\(startId\)/);
    assert.doesNotMatch(body, /stopSelfResult\(startId\)/);
  }
  assert.match(stopIfIdle, /if\s*\(config\s*==\s*null\)\s*stopSelfResult\(startId\)/);
  assert.match(stopFromModule, /service\.config\?\.sessionId\s*==\s*sessionId/);
  assert.match(stopFromModule, /service\.activeStartToken\s*==\s*expectedStartToken/);
  assert.doesNotMatch(stopFromModule, /context\.stopService/);
});

test("start timeout/cancellation is scoped to its token and cannot cancel another room", () => {
  const moduleStart = functionBody(moduleSource, "fun startCall(");
  const stopFromModule = functionBody(service, "internal fun stopFromModule(");
  const handleStart = functionBody(service, "private fun handleStart(");

  assert.match(moduleStart, /startToken\.get\(\)/);
  assert.match(stopFromModule, /pendingSession\s*==\s*sessionId/);
  assert.match(stopFromModule, /expectedStartToken\s*==\s*null\s*\|\|\s*token\s*==\s*expectedStartToken/);
  assert.match(handleStart, /consumeCancelledStart\(startToken\)/);
  assert.match(handleStart, /cancelledStartTokens\.contains\(startToken\)/);
});

test("disconnect persists for ack, then has a bounded process-teardown fallback", () => {
  const action = functionBody(service, "private fun handleNotificationAction(");
  const watchdog = functionBody(service, "private fun armDisconnectWatchdog(");
  const ack = functionBody(moduleSource, "fun ackAction(");

  assert.ok(action.indexOf("VoiceSessionActionQueue.enqueue") < action.indexOf("armDisconnectWatchdog"));
  assert.match(watchdog, /postDelayed\(runnable,\s*DISCONNECT_WATCHDOG_MS\)/);
  assert.match(watchdog, /activeSessionId\s*!=\s*null\s*&&\s*activeSessionId\s*!=\s*sessionId/);
  assert.match(watchdog, /Process\.killProcess\(Process\.myPid\(\)\)/);
  assert.match(ack, /VoiceSessionActionQueue\.find/);
  assert.match(ack, /VoiceSessionActionQueue\.acknowledge/);
  assert.match(ack, /VoiceSessionService\.acknowledgeDisconnect/);
  assert.match(queue, /commit\(\)/);
});

test("Android 14 microphone FGS promotion is rejected while Activity is not resumed", () => {
  const guardStart = service.indexOf("private fun requiresVisibleMicrophonePromotion(");
  const guardEnd = service.indexOf("private fun hasRequiredRuntimePermissions(", guardStart);
  assert.notEqual(guardStart, -1);
  const guard = service.slice(guardStart, guardEnd);
  const update = functionBody(service, "private fun updateConfig(");
  const moduleUpdate = functionBody(moduleSource, "fun updateCallState(");

  assert.match(guard, /Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE/);
  assert.match(guard, /!VoiceSessionVisibility\.isActivityResumed\(\)/);
  assert.match(update, /requiresVisibleMicrophonePromotion\(active,\s*next\)/);
  assert.ok(update.indexOf("requiresVisibleMicrophonePromotion") < update.indexOf("startForegroundFor(next)"));
  assert.match(moduleUpdate, /VoiceSessionService\.updateFromModule/);
});

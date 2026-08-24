"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _eventTargetShim = require("./vendor/event-target-shim");
function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
/**
 * @eventClass
 * This event is fired whenever the RTCDataChannel send message.
 * @param {MESSAGE_EVENTS} type - The type of event.
 * @param {IMessageEventInitDict} eventInitDict - The event init properties.
 * @see
 * {@link https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/message_event#event_type MDN} for details.
 */
class MessageEvent extends _eventTargetShim.Event {
  /** @eventProperty */

  constructor(type, eventInitDict) {
    super(type, eventInitDict);
    _defineProperty(this, "data", void 0);
    this.data = eventInitDict.data;
  }
}
exports.default = MessageEvent;
//# sourceMappingURL=MessageEvent.js.map
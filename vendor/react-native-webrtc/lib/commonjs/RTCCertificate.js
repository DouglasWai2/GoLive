"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
class RTCCertificate {
  constructor(info) {
    _defineProperty(this, "_expires", void 0);
    _defineProperty(this, "_fingerprints", void 0);
    _defineProperty(this, "_id", void 0);
    this._id = info.certificateId;
    this._expires = info.expires;
    this._fingerprints = info.fingerprints;
  }
  get expires() {
    return this._expires;
  }
  getFingerprints() {
    return this._fingerprints;
  }
}
exports.default = RTCCertificate;
//# sourceMappingURL=RTCCertificate.js.map
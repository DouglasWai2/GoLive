import { NativeModules } from 'react-native';
import getDisplayMedia from './getDisplayMedia';
import getUserMedia from './getUserMedia';
import { EventTarget, getEventAttributeValue, setEventAttributeValue } from './vendor/event-target-shim';
const {
  WebRTCModule
} = NativeModules;
class MediaDevices extends EventTarget {
  get ondevicechange() {
    return getEventAttributeValue(this, 'devicechange');
  }
  set ondevicechange(value) {
    setEventAttributeValue(this, 'devicechange', value);
  }

  /**
   * W3C "Media Capture and Streams" compatible {@code enumerateDevices}
   * implementation.
   */
  enumerateDevices() {
    return new Promise(resolve => WebRTCModule.enumerateDevices(resolve));
  }

  /**
   * W3C "Screen Capture" compatible {@code getDisplayMedia} implementation.
   * See: https://w3c.github.io/mediacapture-screen-share/
   *
   * @param {*} constraints
   * @returns {Promise}
   */
  getDisplayMedia(constraints) {
    return getDisplayMedia(constraints);
  }

  /**
   * W3C "Media Capture and Streams" compatible {@code getUserMedia}
   * implementation.
   * See: https://www.w3.org/TR/mediacapture-streams/#dom-mediadevices-enumeratedevices
   *
   * @param {*} constraints
   * @returns {Promise}
   */
  getUserMedia(constraints) {
    return getUserMedia(constraints);
  }
}
export default new MediaDevices();
//# sourceMappingURL=MediaDevices.js.map
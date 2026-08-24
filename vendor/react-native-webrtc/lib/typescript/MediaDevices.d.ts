import { Constraints as DisplayMediaConstraints } from './getDisplayMedia';
import { Constraints as UserMediaConstraints } from './getUserMedia';
import { Event, EventTarget } from './vendor/event-target-shim';
declare type MediaDevicesEventMap = {
    devicechange: Event<'devicechange'>;
};
declare class MediaDevices extends EventTarget<MediaDevicesEventMap> {
    get ondevicechange(): EventTarget.CallbackFunction<this, Event<string>> | null;
    set ondevicechange(value: EventTarget.CallbackFunction<this, Event<string>> | null);
    /**
     * W3C "Media Capture and Streams" compatible {@code enumerateDevices}
     * implementation.
     */
    enumerateDevices(): Promise<unknown>;
    /**
     * W3C "Screen Capture" compatible {@code getDisplayMedia} implementation.
     * See: https://w3c.github.io/mediacapture-screen-share/
     *
     * @param {*} constraints
     * @returns {Promise}
     */
    getDisplayMedia(constraints: DisplayMediaConstraints): Promise<import("./MediaStream").default>;
    /**
     * W3C "Media Capture and Streams" compatible {@code getUserMedia}
     * implementation.
     * See: https://www.w3.org/TR/mediacapture-streams/#dom-mediadevices-enumeratedevices
     *
     * @param {*} constraints
     * @returns {Promise}
     */
    getUserMedia(constraints: UserMediaConstraints): Promise<import("./MediaStream").default>;
}
declare const _default: MediaDevices;
export default _default;

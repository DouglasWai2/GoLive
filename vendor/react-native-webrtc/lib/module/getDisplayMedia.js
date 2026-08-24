import { NativeModules } from 'react-native';
import MediaStream from './MediaStream';
import MediaStreamError from './MediaStreamError';
const {
  WebRTCModule
} = NativeModules;
export default function getDisplayMedia() {
  let constraints = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  return new Promise((resolve, reject) => {
    WebRTCModule.getDisplayMedia(constraints).then(data => {
      const {
        streamId,
        track,
        audioTrack
      } = data;
      const info = {
        streamId: streamId,
        streamReactTag: streamId,
        tracks: audioTrack ? [track, audioTrack] : [track]
      };
      const stream = new MediaStream(info);
      resolve(stream);
    }, error => {
      reject(new MediaStreamError(error));
    });
  });
}
//# sourceMappingURL=getDisplayMedia.js.map
